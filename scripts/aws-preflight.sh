#!/usr/bin/env bash
# Vérification préalable AVANT de déployer sur AWS : trouver en une ou deux minutes ce qui ferait échouer le déploiement
# après 10 ou 20 minutes d'attente. Usage : scripts/aws-preflight.sh [--rapide] [--sans-ecriture]
#   --rapide         saute tofu init/validate/plan (le plus long)
#   --sans-ecriture  ne crée aucun objet de test (voir plus bas)
# Ce que le script CRÉE puis SUPPRIME aussitôt, pour tester les droits d'écriture (noms en g13-p5-preflight*, étiquettés
# Group=13) : un paramètre SSM, un rôle IAM et un profil d'instance, un bucket S3. Si le script est interrompu, ils
# apparaissent dans scripts/aws-audit.sh. Il ne crée ni cluster ni instance.
# Résultat de chaque contrôle : [ok] vérifié ici ; [ÉCHEC] bloquant ; [?] non vérifiable ou à surveiller.
# Code de sortie : 0 = aucun échec (les [?] restent possibles), 1 = au moins un échec.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
set +e

QUICK=0; WRITE=1
for a in "$@"; do case "$a" in --rapide) QUICK=1 ;; --sans-ecriture) WRITE=0 ;; *) echo "Option inconnue : $a" >&2; exit 2 ;; esac; done

OKN=0; BAD=0; UNK=0
ok()   { echo "  [ok]     $*"; OKN=$((OKN+1)); }
ko()   { echo "  [ÉCHEC]  $*"; BAD=$((BAD+1)); }
unk()  { echo "  [?]      $*"; UNK=$((UNK+1)); }
sect() { echo; echo "== $*"; }
short() { mask_output | tr '\n' ' ' | cut -c1-220; } # première erreur, masquée, sur une ligne

TFVARS="$INFRA_DIR/terraform.tfvars"
# Valeur d'une variable : terraform.tfvars d'abord, sinon valeur par défaut de variables.tf (vide si aucune).
tfvar() {
  python3 - "$1" "$TFVARS" "$INFRA_DIR/variables.tf" <<'PY'
import re, sys
name, tfvars, varsf = sys.argv[1:4]
try:
    m = re.search(r'^\s*%s\s*=\s*"([^"]*)"' % re.escape(name), open(tfvars).read(), re.M)
    if m: print(m.group(1)); sys.exit()
except OSError:
    pass
b = re.search(r'variable "%s" \{(.*?)\n\}' % re.escape(name), open(varsf).read(), re.S)
if b:
    d = re.search(r'default\s*=\s*"?([^"\n]*)"?', b.group(1))
    if d: print(d.group(1).strip())
PY
}

T0=$(date +%s)
echo "Vérification préalable du déploiement AWS ($(date '+%d.%m.%Y %H:%M'))"

sect "1. Outils et fichiers locaux"
for t in "$TF" aws kubectl python3 perl curl openssl; do
  command -v "$t" >/dev/null && ok "$t présent" || ko "$t absent (à installer)"
done
if command -v "$TF" >/dev/null; then
  v="$("$TF" version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
  if [ -z "$v" ]; then unk "version d'OpenTofu illisible"
  elif python3 -c 'import sys; sys.exit(0 if tuple(map(int, sys.argv[1].split("."))) >= (1,5,7) else 1)' "$v"; then ok "OpenTofu $v (>= 1.5.7 demandé)"
  else ko "OpenTofu $v trop ancien (>= 1.5.7 demandé)"; fi
fi
command -v helm >/dev/null && ok "helm présent" || unk "helm absent : les versions des charts ne seront pas contrôlées"
if [ -f "$TFVARS" ]; then
  ok "terraform.tfvars présent"
  for k in kubernetes_version assistant_image registry_username; do
    val="$(tfvar "$k")"
    case "$val" in ""|X.YY|*"<utilisateur>"*|*NNN*) ko "terraform.tfvars : '$k' absent ou encore à l'état d'exemple" ;; *) ok "terraform.tfvars : $k renseigné" ;; esac
  done
else ko "envs/aws/infra/terraform.tfvars absent (copier terraform.tfvars.example)"; fi
if [ ! -s "$TOKEN_FILE" ]; then ko "jeton du registre absent : $TOKEN_FILE"
elif [ "$(file_mode "$TOKEN_FILE")" != "600" ]; then ko "droits de $TOKEN_FILE : attendu 600"
else ok "jeton du registre présent (droits 600)"; fi
[ -d "$ROOT/.git" ] || [ -f "$ROOT/.git" ] && ok "dépôt Git" || unk "pas de dépôt Git ici"

sect "2. Compte AWS, région, adresse IP"
arn="$(aws sts get-caller-identity --query Arn --output text 2>&1)"
if [ $? -eq 0 ]; then ok "identité AWS : ${arn##*:} (région $REGION)"; else ko "identifiants AWS invalides : $(echo "$arn" | short)"; fi
IP="$(curl -fsS -m 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '\n')"
if [[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then ok "adresse IP publique actuelle : $IP (ajoutée à admin_cidrs par aws-up.sh)"; else ko "adresse IPv4 publique introuvable (IPv6 non géré)"; fi
if aws eks describe-cluster --name "${PREFIX}-eks" --region "$REGION" >/dev/null 2>&1; then
  unk "un cluster ${PREFIX}-eks existe déjà : aws-up.sh le reprend (il ne repart pas de zéro), et il est facturé"
else ok "aucun cluster ${PREFIX}-eks existant"; fi

sect "3. Versions et types d'instance"
KV="$(tfvar kubernetes_version)"
if [ -n "$KV" ]; then
  st="$(aws eks describe-cluster-versions --region "$REGION" --query "clusterVersions[?clusterVersion=='$KV'].versionStatus|[0]" --output text 2>&1)"
  case "$st" in
    STANDARD_SUPPORT) ok "Kubernetes $KV : support standard" ;;
    EXTENDED_SUPPORT) unk "Kubernetes $KV : support ÉTENDU, facturé plus cher que le support standard (prix non relevé ici)" ;;
    None|"") ko "Kubernetes $KV n'est pas proposé par AWS (voir : aws eks describe-cluster-versions)" ;;
    *) unk "Kubernetes $KV : statut '$(echo "$st" | short)'" ;;
  esac
fi
NODE_T="$(tfvar node_instance_type)"; NODE_N="$(tfvar node_count)"; HOST_T="$(tfvar host_instance_type)"
AZS="$(aws ec2 describe-availability-zones --region "$REGION" --filters Name=state,Values=available --query 'AvailabilityZones[].ZoneName' --output text 2>/dev/null | tr '\t' '\n' | sort | head -n2 | paste -sd' ' -)"
if [ -n "$AZS" ] && [ -n "$NODE_T" ] && [ -n "$HOST_T" ]; then
  A1="${AZS%% *}"; A2="${AZS##* }"
  off="$(aws ec2 describe-instance-type-offerings --region "$REGION" --location-type availability-zone \
    --filters "Name=instance-type,Values=$NODE_T,$HOST_T" "Name=location,Values=$A1,$A2" \
    --query 'InstanceTypeOfferings[].[InstanceType,Location]' --output text 2>&1)"
  if [ $? -ne 0 ]; then unk "offre de types d'instance non lisible : $(echo "$off" | short)"; else
    for z in $A1 $A2; do printf '%s\n' "$off" | grep -q "^${NODE_T}[[:space:]]${z}$" && ok "$NODE_T offert en $z" || ko "$NODE_T non offert en $z"; done
    printf '%s\n' "$off" | grep -q "^${HOST_T}[[:space:]]${A1}$" && ok "$HOST_T offert en $A1 (zone de l'hôte)" || ko "$HOST_T non offert en $A1"
  fi
else unk "zones ou types d'instance non déterminés"; fi

sect "4. Limites du compte (partagé avec les autres groupes : leurs ressources comptent aussi)"
vcpu_of() { aws ec2 describe-instance-types --region "$REGION" --instance-types "$1" --query 'InstanceTypes[0].VCpuInfo.DefaultVCpus' --output text 2>/dev/null; }
nodes_v="$(vcpu_of "${NODE_T:-m5.xlarge}")"; host_v="$(vcpu_of "${HOST_T:-t3.small}")"
if [[ "$nodes_v" =~ ^[0-9]+$ && "$host_v" =~ ^[0-9]+$ ]]; then
  need=$(( nodes_v * ${NODE_N:-2} + host_v ))
  quota="$(aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --region "$REGION" --query Quota.Value --output text 2>/dev/null)"
  [[ "$quota" =~ ^[0-9.]+$ ]] || quota="$(aws service-quotas get-aws-default-service-quota --service-code ec2 --quota-code L-1216C47A --region "$REGION" --query Quota.Value --output text 2>/dev/null)"
  used=0
  while read -r c t; do
    [ -n "${t:-}" ] || continue
    v="$(vcpu_of "$t")"; used=$(( used + c * ${v:-0} ))
  done < <(aws ec2 describe-instances --region "$REGION" --filters Name=instance-state-name,Values=pending,running \
             --query 'Reservations[].Instances[].InstanceType' --output text 2>/dev/null | tr '\t' '\n' | grep . | sort | uniq -c)
  if [[ "$quota" =~ ^[0-9.]+$ ]]; then
    q="${quota%.*}"
    if [ $((q - used)) -ge "$need" ]; then ok "vCPU : il en faut $need, $((q - used)) disponibles ($used utilisés sur $q)"
    else ko "vCPU : il en faut $need, seulement $((q - used)) disponibles ($used utilisés sur $q) : attendre qu'un autre groupe détruise ses instances, ou demander une hausse"; fi
  else unk "limite de vCPU non lisible (service-quotas refusé ?) : il en faut $need ($used déjà utilisés) ; une erreur VcpuLimitExceeded signifierait que la limite est atteinte"; fi
else unk "nombre de vCPU non déterminé"; fi
nv="$(aws ec2 describe-vpcs --region "$REGION" --query 'length(Vpcs)' --output text 2>/dev/null)"
qv="$(aws service-quotas get-service-quota --service-code vpc --quota-code L-F678F1CE --region "$REGION" --query Quota.Value --output text 2>/dev/null)"
if [[ "$nv" =~ ^[0-9]+$ ]]; then
  if [[ "$qv" =~ ^[0-9.]+$ ]]; then
    [ "$nv" -lt "${qv%.*}" ] && ok "VPC : $nv existants sur $qv autorisés" || ko "VPC : limite atteinte ($nv sur $qv) : un VPC de plus est impossible"
  else
    [ "$nv" -lt 5 ] && ok "VPC : $nv existants (limite par défaut : 5, limite réelle non lisible)" || unk "VPC : $nv existants, la limite par défaut est 5 : la création du VPC peut échouer (VpcLimitExceeded)"
  fi
else unk "nombre de VPC non lisible"; fi

sect "5. Droits d'écriture (essais réels, objets supprimés aussitôt)"
AMI="$(aws ec2 describe-images --region "$REGION" --owners amazon --filters 'Name=name,Values=al2023-ami-2023.*-x86_64' 'Name=architecture,Values=x86_64' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text 2>/dev/null)"
if [[ "$AMI" =~ ^ami- ]]; then
  ok "image Amazon Linux 2023 trouvée"
  r="$(aws ec2 run-instances --dry-run --region "$REGION" --image-id "$AMI" --instance-type "${HOST_T:-t3.small}" 2>&1)"
  case "$r" in *DryRunOperation*) ok "lancement d'instance EC2 autorisé (essai à blanc)" ;; *UnauthorizedOperation*) ko "lancement d'instance EC2 refusé" ;; *) unk "essai à blanc EC2 non concluant : $(echo "$r" | short)" ;; esac
else ko "image Amazon Linux 2023 introuvable (ec2:DescribeImages refusé ou nom d'image changé)"; fi
r="$(aws ec2 create-vpc --dry-run --region "$REGION" --cidr-block 10.99.0.0/16 2>&1)"
case "$r" in *DryRunOperation*) ok "création de VPC autorisée (essai à blanc)" ;; *UnauthorizedOperation*) ko "création de VPC refusée" ;; *) unk "essai à blanc VPC non concluant : $(echo "$r" | short)" ;; esac
unk "création d'un cluster EKS : non testable sans le créer (aucun essai à blanc n'existe)"
if [ "$WRITE" = 1 ]; then
  PRM="/${PREFIX}/preflight-test"; ROLE="${PREFIX}-preflight"; BKT="${PREFIX}-preflight-$(openssl rand -hex 4)"
  cleanup() {
    aws ssm delete-parameter --name "$PRM" --region "$REGION" >/dev/null 2>&1
    aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE" >/dev/null 2>&1
    aws iam delete-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1
    aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null 2>&1
    aws iam delete-role --role-name "$ROLE" >/dev/null 2>&1
    aws s3api delete-bucket --bucket "$BKT" --region "$REGION" >/dev/null 2>&1
  }
  trap cleanup EXIT
  r="$(aws ssm put-parameter --name "$PRM" --type SecureString --value x --tags Key=Group,Value=13 --region "$REGION" 2>&1)" \
    && ok "SSM : création d'un paramètre chiffré autorisée" || ko "SSM : création d'un paramètre chiffré refusée : $(echo "$r" | short)"
  r="$(aws ssm get-parameter --name "$PRM" --with-decryption --region "$REGION" --query Parameter.Value --output text 2>&1)"
  [ "$r" = "x" ] && ok "SSM : lecture avec déchiffrement (clé par défaut) autorisée" || unk "SSM : lecture avec déchiffrement non concluante : $(echo "$r" | short)"
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  r="$(aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" --tags Key=Group,Value=13 2>&1)" \
    && ok "IAM : création d'un rôle étiqueté autorisée" || ko "IAM : création d'un rôle refusée : $(echo "$r" | short)"
  r="$(aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>&1)" \
    && ok "IAM : attacher une politique gérée AWS autorisé" || ko "IAM : attacher une politique refusé : $(echo "$r" | short)"
  r="$(aws iam create-instance-profile --instance-profile-name "$ROLE" --tags Key=Group,Value=13 2>&1)" \
    && ok "IAM : création d'un profil d'instance étiqueté autorisée" || ko "IAM : création d'un profil d'instance refusée : $(echo "$r" | short)"
  r="$(aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE" 2>&1)" \
    && ok "IAM : rôle ajouté au profil d'instance" || ko "IAM : ajout du rôle au profil refusé : $(echo "$r" | short)"
  unk "IAM : iam:PassRole (donner le rôle à l'instance) : non testable sans lancer l'instance"
  r="$(aws s3api create-bucket --bucket "$BKT" --region "$REGION" 2>&1)" \
    && ok "S3 : création d'un bucket autorisée" || ko "S3 : création d'un bucket refusée : $(echo "$r" | short)"
  cleanup; trap - EXIT
  left="$(aws iam list-roles --query "Roles[?RoleName=='$ROLE'].RoleName" --output text 2>/dev/null)"
  [ -z "$left" ] && ok "objets de test supprimés" || ko "objet de test resté ($ROLE) : lancer scripts/aws-audit.sh"
else unk "essais d'écriture sautés (--sans-ecriture) : les droits SSM, IAM et S3 ne sont pas contrôlés"; fi

sect "6. Modèle Bedrock (avec VOS droits ; le rôle de l'hôte n'est pas testable avant son lancement)"
BM="$(tfvar bedrock_model_id)"
r="$(aws bedrock-runtime converse --region "$REGION" --model-id "${BM:-mistral.mistral-large-3-675b-instruct}" \
  --messages '[{"role":"user","content":[{"text":"Réponds par le mot ok."}]}]' --inference-config '{"maxTokens":8}' \
  --query 'output.message.content[0].text' --output text 2>&1)"
[ $? -eq 0 ] && ok "Bedrock : le modèle répond ($(echo "$r" | head -c 30 | tr '\n' ' '))" || ko "Bedrock : appel impossible : $(echo "$r" | short)"

sect "7. Registre GitLab : l'image existe-t-elle, pour linux/amd64, et le jeton fonctionne-t-il ?"
IMG="$(tfvar assistant_image)"; RU="$(tfvar registry_username)"
if [ -n "$IMG" ] && [ -n "$RU" ] && [ -s "$TOKEN_FILE" ]; then
  RH="${IMG%%/*}"; REST="${IMG#*/}"; RPATH="${REST%:*}"; RTAG="${REST##*:}"
  hdr="$(curl -sI -m 20 "https://$RH/v2/" 2>&1 | tr -d '\r')"
  realm="$(printf '%s\n' "$hdr" | sed -nE 's/.*[Rr]ealm="([^"]*)".*/\1/p' | head -n1)"
  svc="$(printf '%s\n' "$hdr" | sed -nE 's/.*[Ss]ervice="([^"]*)".*/\1/p' | head -n1)"
  if [ -z "$realm" ]; then ko "registre $RH : pas de réponse d'authentification (injoignable depuis ce poste ?)"; else
    tok="$(curl -s -m 20 --config <(printf 'user = "%s:%s"\n' "$RU" "$(tr -d '\n\r ' < "$TOKEN_FILE")") \
      "$realm?service=$svc&scope=repository:$RPATH:pull" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("token",""))
except Exception: print("")')"
    if [ -z "$tok" ]; then ko "registre : le jeton de déploiement est refusé (expiré, supprimé ou mauvais nom d'utilisateur)"; else
      ok "registre : jeton de déploiement accepté"
      man="$(curl -s -m 20 -H "Authorization: Bearer $tok" \
        -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
        "https://$RH/v2/$RPATH/manifests/$RTAG")"
      verdict="$(printf '%s' "$man" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print("illisible"); sys.exit()
if "errors" in d: print("absente"); sys.exit()
ms=d.get("manifests")
if ms is None: print("simple")
else: print("amd64" if any((m.get("platform") or {}).get("architecture")=="amd64" and (m.get("platform") or {}).get("os")=="linux" for m in ms) else "sans-amd64")')"
      case "$verdict" in
        amd64) ok "image $RPATH:$RTAG présente, avec une version linux/amd64" ;;
        sans-amd64) ko "image $RPATH:$RTAG présente mais SANS linux/amd64 (construite sur le Mac en arm64 ?)" ;;
        simple) unk "image $RPATH:$RTAG présente (une seule architecture, non contrôlée)" ;;
        absente) ko "image $RPATH:$RTAG introuvable dans le registre" ;;
        *) unk "réponse du registre illisible" ;;
      esac
    fi
  fi
  unk "le registre répond à ce poste ; qu'il réponde aussi depuis AWS n'est pas vérifiable ici (l'hôte réessaie 6 fois, puis annonce G13-ECHEC)"
else unk "registre non contrôlé (image, utilisateur ou jeton manquants)"; fi

sect "8. Téléchargements publics de l'hôte et des charts"
CV="$(tfvar compose_version)"
code="$(curl -sIL -m 30 -o /dev/null -w '%{http_code}' "https://github.com/docker/compose/releases/download/$CV/docker-compose-linux-x86_64" 2>/dev/null)"
[ "$code" = 200 ] && ok "Docker Compose $CV téléchargeable" || ko "Docker Compose $CV : code HTTP $code (étiquette inexistante ?)"
WI="$(tfvar webui_image)"
if [ -n "$WI" ]; then
  wp="${WI#ghcr.io/}"; wpath="${wp%:*}"; wtag="${wp##*:}"
  wt="$(curl -s -m 20 "https://ghcr.io/token?scope=repository:$wpath:pull" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("token",""))
except Exception: print("")')"
  if [ -n "$wt" ]; then
    code="$(curl -sI -m 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $wt" \
      -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' "https://ghcr.io/v2/$wpath/manifests/$wtag")"
    [ "$code" = 200 ] && ok "Open WebUI $wtag présente dans ghcr.io" || ko "Open WebUI $wtag : code HTTP $code dans ghcr.io"
  else unk "ghcr.io injoignable depuis ce poste : étiquette Open WebUI non contrôlée"; fi
fi
chartver() { grep -oE "^ *$1 += optional\(string, \"[^\"]*\"" "$ROOT/modules/observability/variables.tf" | grep -oE '"[^"]*"$' | tr -d '"'; }
if command -v helm >/dev/null; then
  for spec in "mimir|https://grafana.github.io/helm-charts|mimir-distributed" "loki|https://grafana-community.github.io/helm-charts|loki" \
              "k8s_monitoring|https://grafana.github.io/helm-charts|k8s-monitoring" "grafana|https://grafana-community.github.io/helm-charts|grafana"; do
    IFS='|' read -r key repo chart <<<"$spec"; ver="$(chartver "$key")"
    if [ -z "$ver" ]; then unk "chart $chart : version introuvable dans le module"
    elif helm show chart "$chart" --repo "$repo" --version "$ver" >/dev/null 2>&1; then ok "chart $chart $ver disponible"
    else ko "chart $chart $ver introuvable dans $repo (ou dépôt injoignable)"; fi
  done
fi

sect "9. OpenTofu : syntaxe et plan en lecture seule"
if [ "$QUICK" = 1 ]; then unk "sauté (--rapide)"; elif ! command -v "$TF" >/dev/null || [ ! -s "$TOKEN_FILE" ]; then unk "sauté (outil ou jeton absent)"; else
  TF_VAR_registry_token="$(tr -d '\n\r ' < "$TOKEN_FILE")"; export TF_VAR_registry_token
  update_admin_cidrs >/dev/null 2>&1
  for d in "$INFRA_DIR" "$STACK_DIR"; do
    n="${d#"$ROOT"/}"
    r="$("$TF" -chdir="$d" init -input=false -no-color 2>&1)" && ok "$n : init" || { ko "$n : init échoue : $(echo "$r" | tail -n 3 | short)"; continue; }
    r="$("$TF" -chdir="$d" validate -no-color 2>&1)" && ok "$n : validate" || ko "$n : validate échoue : $(echo "$r" | grep -E 'Error|│' | head -n 3 | short)"
  done
  r="$("$TF" -chdir="$INFRA_DIR" plan -input=false -lock=false -no-color 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then
    line="$(printf '%s\n' "$r" | grep -E '^(Plan:|No changes)' | head -n1)"
    ok "infra : plan sans erreur (${line:-résumé introuvable})"
    printf '%s\n' "$r" | grep -E '^Plan:' >/dev/null && printf '%s\n' "$r" | grep -E '^  # .* (will be|must be) ' | sed -E 's/^  # //' | head -n 12 | mask_output | sed 's/^/             /'
  else ko "infra : le plan échoue : $(printf '%s\n' "$r" | grep -E 'Error|│' | head -n 4 | short)"; fi
fi

echo
echo "== Résultat : $OKN ok, $BAD échec(s), $UNK à surveiller ($(( $(date +%s) - T0 )) s)"
echo "   Ce contrôle ne peut PAS vérifier : la création du cluster EKS, iam:PassRole, l'agent SSM de l'hôte, l'accès de l'hôte"
echo "   au registre et à ghcr.io depuis AWS, le comportement de Docker Compose. Ces points se constatent au premier lancement."
if [ "$BAD" -gt 0 ]; then echo "   => ne PAS lancer aws-up.sh avant d'avoir réglé les [ÉCHEC]."; exit 1; fi
exit 0
