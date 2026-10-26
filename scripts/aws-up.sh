#!/usr/bin/env bash
# Déploie sur AWS : infrastructure (VPC, EKS, S3, IAM) puis pile d'observabilité (Mimir, Loki, Alloy, Grafana).
# COÛT : environ 0,48 $ par heure tant que le cluster existe (plan de contrôle + 2 × m5.xlarge, prix relevés le
# 22.10.2026 ; hors volumes EBS et trafic). Détruire avec scripts/aws-down.sh dès la fin des tests.
# Prérequis : envs/aws/infra/terraform.tfvars avec `kubernetes_version`, `assistant_image` et `registry_username`
# (voir terraform.tfvars.example), et le jeton de déploiement GitLab (read_registry) dans .work/registry-token
# (une ligne, droits 600, ignoré par Git). L'image de l'assistant doit déjà être poussée (linux/amd64).
# N'affiche aucun secret.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"

need "$TF"; need kubectl; need python3
check_aws
[ -f "$INFRA_DIR/terraform.tfvars" ] || { echo "Créer envs/aws/infra/terraform.tfvars (voir terraform.tfvars.example)." >&2; exit 1; }
update_admin_cidrs "${1:-}"

# Hôte EC2 (assistant + Open WebUI) : variables obligatoires et jeton du registre, vérifiés AVANT de créer quoi que ce soit.
for v in kubernetes_version assistant_image registry_username; do
  grep -Eq "^[[:space:]]*$v[[:space:]]*=" "$INFRA_DIR/terraform.tfvars" || {
    echo "terraform.tfvars : variable '$v' manquante (voir terraform.tfvars.example)." >&2; exit 1; }
done
TOKEN_FILE="$WORK/registry-token"
[ -s "$TOKEN_FILE" ] || { echo "Jeton du registre absent : écrire le jeton de déploiement GitLab (read_registry) dans $TOKEN_FILE (une ligne, chmod 600)." >&2; exit 1; }
[ "$(stat -f '%Lp' "$TOKEN_FILE" 2>/dev/null || stat -c '%a' "$TOKEN_FILE")" = "600" ] || { echo "Droits de $TOKEN_FILE : attendu 600 (chmod 600 $TOKEN_FILE)." >&2; exit 1; }
export TF_VAR_registry_token="$(tr -d '\n\r ' < "$TOKEN_FILE")"

echo ">> 1/5 Infrastructure (VPC, EKS, S3, IAM, hôte EC2) : le cluster met plusieurs minutes à apparaître."
"$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve 2>&1 | mask_output

echo ">> 2/5 Kubeconfig et attente des nœuds"
CLUSTER="$("$TF" -chdir="$INFRA_DIR" output -raw cluster_name)"
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" --kubeconfig "$KUBECONFIG_FILE" >/dev/null
chmod 600 "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
for i in $(seq 1 40); do
  ready="$(kubectl get nodes --no-headers 2>/dev/null | grep -c ' Ready' || true)"
  [ "$ready" -ge 2 ] && break
  echo "   nœuds prêts : $ready/2 (essai $i/40)"; sleep 15
done
[ "${ready:-0}" -ge 2 ] || { echo "Les nœuds ne sont pas prêts. Voir 'kubectl get nodes' (KUBECONFIG=$KUBECONFIG_FILE)." >&2; exit 1; }
kubectl get nodes

echo ">> Classe de stockage par défaut (gp3, pilote EBS CSI)"
kubectl apply -f "$STACK_DIR/storageclass.yaml"

echo ">> 3/5 Secrets de la pile (fichier ignoré par Git)"
SECRETS="$STACK_DIR/secrets.auto.tfvars.json"
if [ ! -f "$SECRETS" ]; then
  need openssl
  umask 077
  printf '{\n  "grafana_admin_password": "%s"\n}\n' "$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)" > "$SECRETS"
fi

echo ">> 4/5 Pile d'observabilité (Mimir, Loki, Alloy, Grafana)"
"$TF" -chdir="$STACK_DIR" init -input=false >/dev/null
"$TF" -chdir="$STACK_DIR" apply -input=false -auto-approve -var "kubeconfig_path=$KUBECONFIG_FILE" 2>&1 | mask_output

echo ">> 5/5 Attente d'Open WebUI sur l'hôte (installation de Docker, téléchargement des images : plusieurs minutes)"
WEBUI_URL="$("$TF" -chdir="$INFRA_DIR" output -raw webui_url)"
HOST_ID="$("$TF" -chdir="$INFRA_DIR" output -raw host_instance_id)"
up=0
for i in $(seq 1 60); do
  if curl -fsS -m 5 -o /dev/null "$WEBUI_URL/health" 2>/dev/null; then up=1; break; fi
  echo "   Open WebUI ne répond pas encore (essai $i/60)"; sleep 10
done
if [ "$up" = 1 ]; then
  echo ">> Open WebUI répond : $WEBUI_URL"
  echo ">> Compte : $("$TF" -chdir="$INFRA_DIR" output -raw webui_admin_email) ; mot de passe : $TF -chdir=envs/aws/infra output -raw webui_admin_password"
else
  echo ">> Open WebUI ne répond pas après 10 min. Fin du journal de démarrage de l'hôte (numéros de compte masqués) :" >&2
  aws ec2 get-console-output --instance-id "$HOST_ID" --latest --output text 2>&1 | tail -40 | perl -pe 's/(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/<COMPTE>/g' >&2 || true
fi

echo ">> Terminé. Pour kubectl : export KUBECONFIG=$KUBECONFIG_FILE"
echo ">> RAPPEL : le cluster est facturé à l'heure. Détruire avec : make aws-down"
