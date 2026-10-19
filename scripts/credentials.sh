#!/usr/bin/env bash
# Affiche les identifiants de l'application. À lancer dans VOTRE terminal ; ne pas coller la sortie dans un message.
#
# Source : le fichier <env>/secrets.auto.tfvars.json s'il existe (généré par gen-secrets.sh) ; sinon on les relit dans le
# cluster (variables d'environnement du pod Open WebUI, secret Kubernetes de Grafana), qui reste la référence de ce qui est
# réellement appliqué. Ajouté le 19.10.2026 : le fichier était absent après un test, alors que le cluster tournait.
# Le chemin du secret Grafana (secret « grafana », clé « admin-password ») est celui du chart Grafana standard : NON VÉRIFIÉ
# pour le chart utilisé ici tant que ce script n'a pas été exécuté avec le fichier absent.
set -euo pipefail
ENV_DIR="${1:-envs/local}"
CTX="${KUBE_CONTEXT:-kind-k8s-ai-monitoring}"
F="$ENV_DIR/secrets.auto.tfvars.json"

if [ -f "$F" ]; then
  SRC="fichier $F"
  WEBUI_PW="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["webui_admin_password"])' "$F")"
  GRAFANA_PW="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["grafana_admin_password"])' "$F")"
else
  SRC="cluster ($CTX) : $F est absent"
  WEBUI_PW="$(kubectl --context "$CTX" exec -n open-webui open-webui-0 -c open-webui -- printenv WEBUI_ADMIN_PASSWORD)"
  GRAFANA_PW="$(kubectl --context "$CTX" get secret -n grafana grafana -o jsonpath='{.data.admin-password}' | base64 -d)"
fi

echo "Source : $SRC"
echo "Open WebUI : http://localhost:8080   (make pf-webui)"
echo "  e-mail       : admin@local.invalid"
echo "  mot de passe : $WEBUI_PW"
echo "Grafana    : http://localhost:3000   (make pf-grafana)"
echo "  utilisateur  : admin"
echo "  mot de passe : $GRAFANA_PW"
