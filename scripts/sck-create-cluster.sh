#!/usr/bin/env bash
# Crée un cluster Switch Cloud Kubernetes (SCK, basé sur KKP) via l'API KKP.
#
# Ce qui est CONFIRMÉ par la doc Switch ("Create a Cluster Using the KKP API") :
#   - URL de base : https://sck.cloud.switch.ch
#   - POST /api/v2/projects/<project_id>/clusters, authentification Bearer (token de compte de service KKP, groupe Editor)
#   - projets : GET /api/v1/projects
# Ce qui N'EST PAS dans ce que j'ai pu lire : le contenu exact du JSON (fichier cluster-*.json de la doc) et l'endpoint des
# "presets". Je n'invente donc pas ce JSON : récupérez-le dans la doc Switch et passez-le en argument.
#
# Usage : KKP_TOKEN=... ./sck-create-cluster.sh <project_id> <cluster.json>
set -euo pipefail
: "${KKP_TOKEN:?token du compte de service KKP}"
PROJECT_ID="${1:?project_id}"
JSON="${2:?fichier JSON de la requête}"

curl --silent --show-error --fail \
  --request POST \
  --header "Authorization: Bearer ${KKP_TOKEN}" \
  --data @"${JSON}" \
  "https://sck.cloud.switch.ch/api/v2/projects/${PROJECT_ID}/clusters"
echo
echo "Récupérez ensuite le kubeconfig depuis le portail (la doc consultée ne décrit pas son téléchargement par API)."
