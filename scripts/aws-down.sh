#!/usr/bin/env bash
# Détruit TOUT ce que aws-up.sh a créé, puis lance l'audit. Usage : scripts/aws-down.sh [--yes]
# ATTENTION : les buckets sont vidés et supprimés (les données de Mimir et de Loki sont perdues).
# Ordre : pile Helm -> volumes persistants (sinon les volumes EBS restent facturés) -> infrastructure -> audit.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need "$TF"
check_aws
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Détruire le cluster, les buckets (données perdues) et tout le projet $PREFIX ? [oui/N] " a
  [ "$a" = "oui" ] || { echo "Annulé."; exit 1; }
fi

KUBE_OK=0
if [ -f "$KUBECONFIG_FILE" ] && command -v kubectl >/dev/null && KUBECONFIG="$KUBECONFIG_FILE" kubectl get nodes >/dev/null 2>&1; then KUBE_OK=1; fi

if [ "$KUBE_OK" -eq 1 ]; then
  export KUBECONFIG="$KUBECONFIG_FILE"
  echo ">> 1/4 Suppression de la pile Helm"
  if [ -f "$STACK_DIR/terraform.tfstate" ]; then
    "$TF" -chdir="$STACK_DIR" init -input=false >/dev/null
    "$TF" -chdir="$STACK_DIR" destroy -input=false -auto-approve -var "kubeconfig_path=$KUBECONFIG_FILE" \
      || echo "!! destroy de la pile en échec : on continue, l'audit final dira ce qui reste."
  fi
  echo ">> 2/4 Suppression des services LoadBalancer et des volumes persistants (évite des ressources orphelines)"
  kubectl get svc -A --no-headers 2>/dev/null | awk '$3=="LoadBalancer"{print $1" "$2}' | while read -r ns n; do
    kubectl delete svc -n "$ns" "$n" --wait=true || true; done
  kubectl delete pvc --all -A --wait=true --timeout=300s || true
  kubectl wait --for=delete pv --all --timeout=300s 2>/dev/null || true
else
  echo "!! Cluster injoignable (ou kubeconfig absent) : étapes Helm et volumes ignorées. L'audit final dira ce qui reste."
fi

echo ">> 3/4 Suppression de l'infrastructure (EKS, VPC, S3, IAM)"
if [ -f "$INFRA_DIR/terraform.tfstate" ]; then
  "$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
  "$TF" -chdir="$INFRA_DIR" destroy -input=false -auto-approve
else
  echo "   pas d'état local pour envs/aws/infra : rien à détruire par OpenTofu."
fi

echo ">> 4/4 Audit"
exec "$ROOT/scripts/aws-audit.sh"
