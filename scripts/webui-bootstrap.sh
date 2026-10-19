#!/usr/bin/env bash
# Crée (ou met à jour) l'entrée de modèle de l'espace de travail d'Open WebUI pour le modèle LLM :
# prompt système de recopie, contexte num_ctx, outil de l'assistant activé par défaut, outils intégrés désactivés.
#
# Pourquoi un appel d'API et pas une variable d'environnement : dans Open WebUI v0.12.0, le prompt système d'un
# modèle n'est appliqué (utils/chat.py) que s'il existe une entrée de modèle dans la base (`Models.get_model_by_id`) ;
# DEFAULT_MODEL_PARAMS ne le fournit pas. Constaté le 18.10.2026 : avec seulement DEFAULT_MODEL_PARAMS, le modèle répondait
# « Je suis Qwen » et ne suivait pas le prompt système.
#
# Sans secret en argument : on s'exécute DANS le pod d'Open WebUI, dont l'environnement contient déjà
# WEBUI_ADMIN_EMAIL et WEBUI_ADMIN_PASSWORD. Idempotent (création, ou mise à jour si l'entrée existe).
# Variables : KUBE_CONTEXT (optionnel), LLM_MODEL (qwen3:8b), LLM_NUM_CTX (8192),
#             WEBUI_THINK ("false" par défaut ; "true" l'active ; "default" ne fixe pas le paramètre Ollama `think`).
# Pourquoi `think: false` par défaut : la passe de recopie d'Open WebUI n'a pas besoin de raisonner ; mesuré le 19.10.2026
# (qwen3:8b, Kind local) : sans, la génération de cette passe durait 24,7 s pour 215 tokens, avec 7,9 s pour 89 tokens
# (logs Ollama ; comparaison indicative, une seule exécution). Contrôles effectués avec `false` : l'outil est appelé,
# le texte final reprend le champ `answer`, le modèle se présente comme l'assistant de supervision.
# Testé de bout en bout en local le 19.10.2026 (création -> 401 « id déjà pris » -> mise à jour).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
K="kubectl ${KUBE_CONTEXT:+--context $KUBE_CONTEXT}"
MODEL="${LLM_MODEL:-qwen3:8b}"
NUM_CTX="${LLM_NUM_CTX:-8192}"
THINK="${WEBUI_THINK:-false}"
PROMPT="$(cat "$HERE/webui-relay-prompt.txt")"

$K exec -i -n open-webui open-webui-0 -- env \
  "RELAY_PROMPT=$PROMPT" "MODEL=$MODEL" "NUM_CTX=$NUM_CTX" "THINK=$THINK" python - <<'PY'
import json, os, sys, time, urllib.error, urllib.request as u
from urllib.parse import quote

BASE = "http://localhost:8080"

def call(path, data=None, token=None):
    req = u.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None,
                    headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    return json.load(u.urlopen(req, timeout=60))

# Attente de l'application : constaté le 19.10.2026, « Connection refused » juste après la fin du déploiement Helm. Cause
# probable, non vérifiée : le pod est déclaré prêt avant qu'Open WebUI n'écoute (il télécharge un modèle d'embedding au démarrage).
for _ in range(60):
    try:
        u.urlopen(BASE + "/health", timeout=5)
        break
    except Exception:
        time.sleep(5)
else:
    sys.exit("Open WebUI ne répond pas sur /health après 5 min")

tok = call("/api/v1/auths/signin", {"email": os.environ["WEBUI_ADMIN_EMAIL"], "password": os.environ["WEBUI_ADMIN_PASSWORD"]})["token"]

model = os.environ["MODEL"]
params = {"system": os.environ["RELAY_PROMPT"], "num_ctx": int(os.environ["NUM_CTX"])}
if os.environ.get("THINK") in ("true", "false"):
    params["think"] = os.environ["THINK"] == "true"

form = {
    "id": model,
    "base_model_id": None,           # entrée qui personnalise le modèle de base portant le même identifiant
    "name": model,
    "meta": {"capabilities": {"builtin_tools": False}, "toolIds": ["server:cluster-assistant"]},
    "params": params,
    "is_active": True,
}

try:
    call("/api/v1/models/create", form, tok)
    print("entrée de modèle créée :", model)
except urllib.error.HTTPError as e:
    # Identifiant déjà pris : mise à jour. Toute autre cause fera échouer l'appel suivant avec son propre message.
    call("/api/v1/models/model/update", form, tok)
    print("entrée de modèle mise à jour :", model, "(création refusée avec le code", e.code, ")")

check = call("/api/v1/models/model?id=" + quote(model), token=tok)
p = (check or {}).get("params") or {}
ok = p.get("system", "").startswith("Tu es l") and p.get("num_ctx") == int(os.environ["NUM_CTX"])
print("relecture :", "OK (prompt système et num_ctx présents)" if ok else "ÉCHEC : %r" % list(p))
sys.exit(0 if ok else 1)
PY
