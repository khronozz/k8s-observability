#!/usr/bin/env bash
# Autorise l'adresse IP publique actuelle (nouveau lieu de travail) à joindre l'API Kubernetes et Open WebUI,
# sans recréer le cluster. Usage : scripts/aws-allow-ip.sh [--reset]   (--reset : ne garder que l'adresse actuelle)
# Comportement de la mise à jour des adresses de l'API EKS (durée, interruption) : NON vérifié.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need "$TF"
check_aws
update_admin_cidrs "${1:-}"
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve
