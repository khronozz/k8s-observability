#!/usr/bin/env bash
# Recrée UNIQUEMENT l'hôte EC2 (assistant + Open WebUI), sans toucher au cluster ni aux buckets. À utiliser quand le
# démarrage de l'hôte a échoué (le script de démarrage ne s'exécute qu'une fois par instance) ou après un changement
# de la configuration de l'hôte. Durée : environ 5 à 15 min, surtout le téléchargement des images.
# Usage : scripts/aws-redo-host.sh
# Remarque : un apply complet reste appliqué ; s'il y a d'autres changements en attente, ils le sont aussi.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need "$TF"
check_aws
require_registry_token
update_admin_cidrs ""
"$TF" -chdir="$INFRA_DIR" init -input=false >/dev/null
"$TF" -chdir="$INFRA_DIR" apply -input=false -auto-approve -replace=aws_instance.host 2>&1 | mask_output
WEBUI_URL="$("$TF" -chdir="$INFRA_DIR" output -raw webui_url)"
HOST_ID="$("$TF" -chdir="$INFRA_DIR" output -raw host_instance_id)"
if wait_webui "$WEBUI_URL" "$HOST_ID" 1500; then echo ">> Open WebUI répond : $WEBUI_URL"; else
  echo ">> L'hôte n'est toujours pas opérationnel : lire la sortie ci-dessus (repère G13-ECHEC)." >&2; exit 1; fi
