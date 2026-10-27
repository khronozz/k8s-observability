#!/usr/bin/env bash
# Détruit TOUT ce que aws-up.sh a créé, puis lance l'audit. Usage : scripts/aws-down.sh [--yes]
# ATTENTION : les buckets sont vidés et supprimés (les données de Mimir et de Loki sont perdues).
# Ordre : pile Helm -> volumes persistants (sinon les volumes EBS restent facturés) -> infrastructure -> audit.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need "$TF"
check_aws
load_registry_token_for_destroy
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Détruire le cluster, les buckets (données perdues) et tout le projet $PREFIX ? [oui/N] " a
  [ "$a" = "oui" ] || { echo "Annulé."; exit 1; }
fi

KUBE_OK=0
echo ">> 0/4 Accès à l'API du cluster (ajoute l'adresse IP actuelle si elle a changé)"
if command -v kubectl >/dev/null && ensure_api_access; then KUBE_OK=1; fi

if [ "$KUBE_OK" -eq 1 ]; then
  export KUBECONFIG="$KUBECONFIG_FILE"
  echo ">> 1/4 Suppression de la pile Helm"
  if [ -f "$STACK_DIR/terraform.tfstate" ]; then
    "$TF" -chdir="$STACK_DIR" init -input=false >/dev/null
    "$TF" -chdir="$STACK_DIR" destroy -input=false -auto-approve -var "kubeconfig_path=$KUBECONFIG_FILE" 2>&1 | mask_output \
      || echo "!! destroy de la pile en échec : on continue, l'audit final dira ce qui reste."
  fi
  echo ">> 2/4 Suppression des services LoadBalancer et des volumes persistants (évite des ressources orphelines)"
  kubectl --request-timeout=30s get svc -A --no-headers 2>/dev/null | awk '$3=="LoadBalancer"{print $1" "$2}' | while read -r ns n; do
    kubectl delete svc -n "$ns" "$n" --wait=true --timeout=300s || true; done
  kubectl delete pvc --all -A --wait=true --timeout=600s || true
  kubectl wait --for=delete pv --all --timeout=600s 2>/dev/null || true
else
  echo "!! Cluster absent ou injoignable : étapes Helm et volumes ignorées. S'il existe, les volumes EBS créés par Kubernetes" >&2
  echo "!! restent facturés (petits, mais réels) : l'audit final les listera." >&2
fi

echo ">> 3/4 Suppression de l'infrastructure (EKS, VPC, S3, IAM)"
if [ -f "$INFRA_DIR/terraform.tfstate" ]; then
  "$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
  "$TF" -chdir="$INFRA_DIR" destroy -input=false -auto-approve 2>&1 | mask_output
else
  echo "   pas d'état local pour envs/aws/infra : rien à détruire par OpenTofu."
fi

echo ">> 4/4 Audit"
exec "$ROOT/scripts/aws-audit.sh"
