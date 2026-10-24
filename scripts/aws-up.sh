#!/usr/bin/env bash
# Déploie sur AWS : infrastructure (VPC, EKS, S3, IAM) puis pile d'observabilité (Mimir, Loki, Alloy, Grafana).
# COÛT : environ 0,48 $ par heure tant que le cluster existe (plan de contrôle + 2 × m5.xlarge, prix relevés le
# 22.10.2026 ; hors volumes EBS et trafic). Détruire avec scripts/aws-down.sh dès la fin des tests.
# Prérequis : envs/aws/infra/terraform.tfvars avec `kubernetes_version` (voir terraform.tfvars.example).
# N'affiche aucun secret.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"

need "$TF"; need kubectl; need python3
check_aws
[ -f "$INFRA_DIR/terraform.tfvars" ] || { echo "Créer envs/aws/infra/terraform.tfvars (voir terraform.tfvars.example)." >&2; exit 1; }
update_admin_cidrs "${1:-}"

echo ">> 1/4 Infrastructure (VPC, EKS, S3, IAM) : le cluster met plusieurs minutes à apparaître."
"$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve

echo ">> 2/4 Kubeconfig et attente des nœuds"
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

echo ">> 3/4 Secrets de la pile (fichier ignoré par Git)"
SECRETS="$STACK_DIR/secrets.auto.tfvars.json"
if [ ! -f "$SECRETS" ]; then
  need openssl
  umask 077
  printf '{\n  "grafana_admin_password": "%s"\n}\n' "$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)" > "$SECRETS"
fi

echo ">> 4/4 Pile d'observabilité (Mimir, Loki, Alloy, Grafana)"
"$TF" -chdir="$STACK_DIR" init -input=false >/dev/null
"$TF" -chdir="$STACK_DIR" apply -input=false -auto-approve -var "kubeconfig_path=$KUBECONFIG_FILE"

echo ">> Terminé. Pour kubectl : export KUBECONFIG=$KUBECONFIG_FILE"
echo ">> RAPPEL : le cluster est facturé à l'heure. Détruire avec : make aws-down"
