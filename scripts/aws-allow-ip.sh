#!/usr/bin/env bash
# Autorise l'adresse IP publique actuelle (nouveau lieu de travail) à joindre l'API Kubernetes et Open WebUI,
# sans recréer le cluster. Usage : scripts/aws-allow-ip.sh [--reset]   (--reset : ne garder que l'adresse actuelle)
# N'applique QUE le cluster EKS (liste d'adresses de l'API) et les règles d'Open WebUI (-target), pour ne pas déclencher
# d'autres changements en passant (un apply complet peut aussi mettre à jour des modules complémentaires ; constaté au
# plan du 26.10.2026). OpenTofu affiche alors « Applied changes may be incomplete » : c'est normal avec -target.
# Durée de la mise à jour de l'API EKS : quelques minutes (non mesurée précisément).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need "$TF"
check_aws
require_registry_token   # la variable est obligatoire pour OpenTofu ; sa vraie valeur évite d'écraser le paramètre SSM
update_admin_cidrs "${1:-}"
"$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve \
  -target='module.eks.aws_eks_cluster.this[0]' -target='aws_vpc_security_group_ingress_rule.webui' 2>&1 | mask_output
ensure_api_access && echo ">> kubectl répond depuis cette adresse (kubeconfig : $KUBECONFIG_FILE)" || echo "!! kubectl ne répond pas encore : réessayer dans une minute" >&2
