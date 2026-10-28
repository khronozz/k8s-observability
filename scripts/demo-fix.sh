#!/usr/bin/env bash
# Répare les accès d'un membre du groupe pour la démonstration, SANS OpenTofu (n'importe quel poste peut le lancer) :
#   1. crée, si elle manque, l'entrée d'accès EKS de ton identité AWS (rôle d'administrateur du cluster) ;
#   2. autorise ton adresse IPv4 publique sur Open WebUI (port 3000 de l'hôte) ;
#   3. autorise ton adresse sur l'API Kubernetes (quelques minutes) puis écrit le kubeconfig .work/aws-kubeconfig.
# Idempotent : on peut le relancer sans risque. Il n'ajoute que TON adresse et TON identité ; il ne supprime rien.
# À relancer à chaque changement de lieu ou de réseau (l'adresse IP change).
#
# Limite : ces ajouts sont faits en dehors d'OpenTofu. Ils disparaissent à la destruction (make aws-down). Si Nicolas lance
# « make aws-allow-ip » AVANT la démonstration, la liste de l'API est recalculée depuis .work/admin-cidrs.txt : ton adresse
# disparaîtrait si elle n'y figure pas. Prévenir Nicolas, ou relancer ce script ensuite.
# Les droits IAM nécessaires (eks:CreateAccessEntry, ec2:AuthorizeSecurityGroupIngress, eks:UpdateClusterConfig) ne sont
# pas vérifiés d'avance : en cas de refus (AccessDenied), le message l'indique et Nicolas peut faire l'étape à ta place.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need aws; need curl; need kubectl
check_aws
CLUSTER="${PREFIX}-eks"

arn="$(aws sts get-caller-identity --query Arn --output text)"
case "$arn" in
  *:assumed-role/*)
    PRINCIPAL="arn:aws:iam::$(printf '%s' "$arn" | cut -d: -f5):role/$(printf '%s' "$arn" | cut -d/ -f2)"
    echo ">> Connexion par rôle : l'entrée d'accès porte sur le rôle (sans chemin). Si tu te connectes par SSO et que kubectl refuse encore, dis-le à Nicolas." ;;
  *) PRINCIPAL="$arn" ;;
esac

ip="$(curl -fsS -m 10 https://checkip.amazonaws.com | tr -d '\n')" || { echo "Adresse IP publique introuvable." >&2; exit 1; }
[[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Adresse non IPv4 : '$ip' (IPv6 non géré)." >&2; exit 1; }
echo ">> Ton adresse publique : $ip"

aws eks describe-cluster --name "$CLUSTER" --region "$REGION" >/dev/null 2>&1 || { echo "Cluster $CLUSTER introuvable : il n'existe plus, ou tes droits ne couvrent pas EKS." >&2; exit 1; }

echo; echo "== 1. Entrée d'accès EKS"
if aws eks list-access-entries --cluster-name "$CLUSTER" --region "$REGION" --query accessEntries --output text 2>/dev/null \
    | tr '\t' '\n' | grep -qx "$PRINCIPAL"; then
  echo "   déjà présente."
else
  aws eks create-access-entry --cluster-name "$CLUSTER" --region "$REGION" --principal-arn "$PRINCIPAL" >/dev/null \
    || { echo "!! Création refusée. Demande à Nicolas de lancer :" >&2
         echo "   aws eks create-access-entry --cluster-name $CLUSTER --principal-arn <TON_ARN>" >&2
         echo "   aws eks associate-access-policy --cluster-name $CLUSTER --principal-arn <TON_ARN> --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster" >&2
         echo "   (ton ARN : ${arn##*:} ; Nicolas le complète avec le numéro de compte)" >&2; exit 1; }
  aws eks associate-access-policy --cluster-name "$CLUSTER" --region "$REGION" --principal-arn "$PRINCIPAL" \
    --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster >/dev/null
  echo "   créée (administrateur du cluster)."
fi

echo; echo "== 2. Open WebUI (port 3000 de l'hôte)"
SG="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=${PREFIX}-host" --query 'SecurityGroups[0].GroupId' --output text)"
[ -n "$SG" ] && [ "$SG" != "None" ] || { echo "Groupe de sécurité ${PREFIX}-host introuvable : l'hôte existe-t-il ? (Nicolas : make aws-redo-host)" >&2; exit 1; }
if aws ec2 describe-security-group-rules --region "$REGION" --filters "Name=group-id,Values=$SG" \
    --query 'SecurityGroupRules[?IsEgress==`false` && FromPort==`3000`].CidrIpv4' --output text | tr '\t' '\n' | grep -qx "$ip/32"; then
  echo "   $ip/32 déjà autorisée."
else
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=3000,ToPort=3000,IpRanges=[{CidrIp=$ip/32,Description='Open WebUI, demonstration (ajout manuel)'}]" >/dev/null
  echo "   $ip/32 autorisée."
fi

echo; echo "== 3. API Kubernetes (peut prendre quelques minutes)"
ensure_api_access && echo ">> kubectl répond depuis cette adresse (kubeconfig : $KUBECONFIG_FILE)" \
  || { echo "!! kubectl ne répond pas encore : attends une minute et lance scripts/demo-check.sh" >&2; exit 1; }
echo; echo "Terminé. Vérifie avec : scripts/demo-check.sh"
