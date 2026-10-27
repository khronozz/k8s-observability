#!/usr/bin/env bash
# Audit en LECTURE SEULE : cherche ce qui appartient encore au projet (étiquettes Group=13 et Project=P5-monitoring-k8s-ai,
# préfixe de nom g13-p5) et peut être facturé. Ne modifie rien.
# Limites : les ressources sans étiquette ni préfixe (ex. volumes ou équilibreurs créés par Kubernetes) ne sont
# trouvées que par les contrôles dédiés ci-dessous ; la liste n'est pas prouvée exhaustive.
# Code de sortie : 0 = rien trouvé, 1 = ressources restantes.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
set +e
check_aws
# Drapeau dans un fichier : `report` tourne dans un sous-processus (tube), une variable n'y serait pas conservée.
FLAG="$(mktemp)"; rm -f "$FLAG"; trap 'rm -f "$FLAG"' EXIT
section() { echo; echo "== $1"; }
report() { # $1 = libellé, stdin = lignes trouvées
  local out; out="$(cat)"
  if [ -n "$out" ] && [ "$out" != "None" ]; then echo "$out" | sed 's/^/   /'; touch "$FLAG"; else echo "   rien"; fi
}

section "Ressources étiquetées Group=13 / Project=P5-monitoring-k8s-ai (API d'étiquettes)"
# L'index d'étiquettes garde parfois pendant plusieurs minutes des entrées de ressources déjà supprimées (constaté le
# 26.10.2026 : 4 règles de groupe de sécurité listées après leur suppression). Pour les types EC2 courants on demande
# donc à EC2 si la ressource existe encore ; sinon l'entrée est signalée comme périmée et ne compte pas.
exists_ec2() { # $1 = type, $2 = identifiant ; 0 = existe ou indéterminé, 1 = n'existe plus
  local out
  case "$1" in
    security-group-rule) out="$(aws ec2 describe-security-group-rules --region "$REGION" --security-group-rule-ids "$2" 2>&1)" ;;
    security-group)      out="$(aws ec2 describe-security-groups --region "$REGION" --group-ids "$2" 2>&1)" ;;
    vpc)                 out="$(aws ec2 describe-vpcs --region "$REGION" --vpc-ids "$2" 2>&1)" ;;
    subnet)              out="$(aws ec2 describe-subnets --region "$REGION" --subnet-ids "$2" 2>&1)" ;;
    route-table)         out="$(aws ec2 describe-route-tables --region "$REGION" --route-table-ids "$2" 2>&1)" ;;
    internet-gateway)    out="$(aws ec2 describe-internet-gateways --region "$REGION" --internet-gateway-ids "$2" 2>&1)" ;;
    volume)              out="$(aws ec2 describe-volumes --region "$REGION" --volume-ids "$2" 2>&1)" ;;
    *) return 0 ;;
  esac
  printf '%s' "$out" | grep -q 'NotFound' && return 1
  return 0
}
tagged="$(aws resourcegroupstaggingapi get-resources --region "$REGION" \
  --tag-filters Key=Group,Values=13 Key=Project,Values=P5-monitoring-k8s-ai \
  --query 'ResourceTagMappingList[].ResourceARN' --output text 2>&1 | tr '\t' '\n')"
while IFS= read -r arn; do
  [ -n "$arn" ] || continue
  short_arn="$(printf '%s' "$arn" | sed -E 's/arn:aws:([a-z0-9-]+):[a-z0-9-]*:[0-9]*:/\1 : /')"
  if [[ "$arn" =~ ^arn:aws:ec2:[^:]*:[0-9]*:([a-z-]+)/(.+)$ ]] && ! exists_ec2 "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"; then
    echo "   (entrée périmée de l'index, la ressource n'existe plus, ignorée : $short_arn)" >&2
  else printf '%s\n' "$short_arn"; fi
done <<<"$tagged" | report

section "Clusters EKS"
aws eks list-clusters --region "$REGION" --query "clusters[?starts_with(@, '$PREFIX')]" --output text 2>&1 | tr '\t' '\n' | report

section "Instances EC2 (hors terminées) portant l'étiquette Group=13"
aws ec2 describe-instances --region "$REGION" --filters Name=tag:Group,Values=13 \
  Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType]' --output text 2>&1 | report

section "Volumes EBS (étiquette du projet, créés par Kubernetes, ou non attachés)"
{ aws ec2 describe-volumes --region "$REGION" --filters Name=tag:Group,Values=13 \
    --query 'Volumes[].[VolumeId,State,Size]' --output text
  aws ec2 describe-volumes --region "$REGION" --filters "Name=tag-key,Values=kubernetes.io/cluster/${PREFIX}-eks" \
    --query 'Volumes[].[VolumeId,State,Size]' --output text
  aws ec2 describe-volumes --region "$REGION" --filters Name=tag-key,Values=ebs.csi.aws.com/cluster \
    --query 'Volumes[].[VolumeId,State,Size]' --output text; } 2>&1 | sort -u | report
echo "   (info, tous propriétaires confondus) volumes non attachés dans la région :" \
  "$(aws ec2 describe-volumes --region "$REGION" --filters Name=status,Values=available --query 'length(Volumes)' --output text 2>&1)"

section "Équilibreurs de charge (classiques et v2) dont le nom ou le VPC rappelle le projet"
VPCS="$(aws ec2 describe-vpcs --region "$REGION" --filters Name=tag:Group,Values=13 --query 'Vpcs[].VpcId' --output text 2>&1)"
{ aws elb describe-load-balancers --region "$REGION" --query 'LoadBalancerDescriptions[].[LoadBalancerName,VPCId]' --output text
  aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].[LoadBalancerName,VpcId]' --output text; } 2>&1 \
  | { grep -E "$PREFIX|$(echo "${VPCS:-NONE}" | tr '\t' '|')" || true; } | report

section "Passerelles NAT et adresses Elastic IP"
aws ec2 describe-nat-gateways --region "$REGION" --filter Name=state,Values=pending,available \
  Name=tag:Group,Values=13 --query 'NatGateways[].NatGatewayId' --output text 2>&1 | report
aws ec2 describe-addresses --region "$REGION" --filters Name=tag:Group,Values=13 \
  --query 'Addresses[].AllocationId' --output text 2>&1 | report

section "VPC et groupes de sécurité du projet"
aws ec2 describe-vpcs --region "$REGION" --filters "Name=tag:Name,Values=${PREFIX}-*" \
  --query 'Vpcs[].VpcId' --output text 2>&1 | report
{ aws ec2 describe-security-groups --region "$REGION" --filters Name=tag:Group,Values=13 \
    --query 'SecurityGroups[].[GroupId,GroupName]' --output text
  aws ec2 describe-security-groups --region "$REGION" --filters "Name=tag-key,Values=kubernetes.io/cluster/${PREFIX}-eks" \
    --query 'SecurityGroups[].[GroupId,GroupName]' --output text; } 2>&1 | sort -u | report

section "Buckets S3 préfixés $PREFIX"
aws s3api list-buckets --query "Buckets[?starts_with(Name, '${PREFIX}-')].Name" --output text 2>&1 | tr '\t' '\n' | report

section "Utilisateurs IAM préfixés $PREFIX"
aws iam list-users --query "Users[?starts_with(UserName, '${PREFIX}-')].UserName" --output text 2>&1 | tr '\t' '\n' | report

section "Rôles IAM préfixés $PREFIX (cluster, nœuds, instance)"
aws iam list-roles --query "Roles[?starts_with(RoleName, '${PREFIX}-')].RoleName" --output text 2>&1 | tr '\t' '\n' | report

echo
if [ ! -e "$FLAG" ]; then echo "AUDIT : rien trouvé (selon les contrôles ci-dessus)."; exit 0
else echo "AUDIT : RESSOURCES RESTANTES (voir ci-dessus) : à supprimer avant de quitter, elles peuvent être facturées."; exit 1; fi
