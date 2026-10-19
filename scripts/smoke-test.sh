#!/usr/bin/env bash
# Contrôles de bout en bout, sans interface graphique et sans secret passé en argument (les identifiants d'Open WebUI
# sont lus dans les variables d'environnement du pod). Ne modifie rien dans le cluster.
# Chaque contrôle affiche OK ou ÉCHEC et le script continue ; code de sortie 1 si un échec.
# Exécuté de bout en bout les 18 et 19.10.2026. Le contrôle 1 attend désormais jusqu'à 5 min (voir plus bas) : cette
# modification n'a pas encore été exécutée.
set -uo pipefail

CTX="${KUBE_CONTEXT:-kind-k8s-ai-monitoring}"
K="kubectl --context $CTX"
fail=0
ok()   { echo "  OK     $*"; }
ko()   { echo "  ÉCHEC  $*"; fail=1; }

echo ">> 1. Pods : aucun pod hors Running/Completed (attente jusqu'à 5 min)"
# Constaté le 19.10.2026 : juste après « tofu apply », deux pods d'Alloy étaient encore en ContainerCreating (cause non vérifiée, probablement le téléchargement
# d'image) alors que le déploiement était terminé ; un contrôle instantané échouait à tort. On réessaie donc pendant 5 min.
bad=""
for _ in $(seq 1 30); do
  bad="$($K get pods -A --no-headers | awk '$4!="Running" && $4!="Completed" {print $1"/"$2" "$4}')"
  [ -z "$bad" ] && break
  sleep 10
done
if [ -z "$bad" ]; then ok "tous les pods sont Running ou Completed"; else ko "pods en défaut après 5 min :"; echo "$bad" | sed 's/^/           /'; fi

echo ">> 2. Ollama : le modèle est présent"
if $K exec -n ollama deploy/ollama -- ollama list | grep -q "qwen3:8b"; then ok "qwen3:8b listé par ollama"; else ko "qwen3:8b absent de 'ollama list'"; fi

echo ">> 3. Assistant : /health"
if $K exec -n assistant deploy/assistant -- python -c "import urllib.request as u; print(u.urlopen('http://localhost:8000/health', timeout=10).read().decode())" | grep -q ok; then ok "/health répond"; else ko "/health ne répond pas"; fi

echo ">> 4. Métriques : la série up du cluster est dans Mimir (attente jusqu'à 5 min, Alloy envoie une minute après son démarrage)"
# Boucle dans le pod (python) : count(up) doit renvoyer au moins une série.
out="$($K exec -i -n assistant deploy/assistant -- python - <<'PY'
import json, time, urllib.parse, urllib.request as u
q = urllib.parse.quote('count(up{cluster="kind-local"})')
last = ""
for _ in range(30):
    try:
        d = json.load(u.urlopen("http://localhost:8000/metrics/query?query=" + q, timeout=20))
        last = json.dumps(d)[:200]
        if d.get("series_total", 0) >= 1:
            print("TROUVE", last); raise SystemExit(0)
    except SystemExit:
        raise
    except Exception as e:
        last = repr(e)[:200]
    time.sleep(10)
print("ABSENT", last); raise SystemExit(1)
PY
)"
if echo "$out" | grep -q "^TROUVE"; then ok "réponse de Mimir : ${out:0:220}"; else ko "aucune série après 5 min : ${out:0:220}"; fi

echo ">> 5. Open WebUI : compte administrateur, outil et réglages du modèle (identifiants lus dans le pod)"
$K exec -i -n open-webui open-webui-0 -- python - <<'PY'
import json, os, sys, urllib.request as u

BASE = "http://localhost:8080"
def call(path, data=None, token=None):
    req = u.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None,
                    headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    return json.load(u.urlopen(req, timeout=60))

bad = 0
def check(label, cond, detail=""):
    global bad
    print(("  OK     " if cond else "  ÉCHEC  ") + label + (" " + detail if detail and not cond else ""))
    bad += 0 if cond else 1

try:
    tok = call("/api/v1/auths/signin", {"email": os.environ["WEBUI_ADMIN_EMAIL"], "password": os.environ["WEBUI_ADMIN_PASSWORD"]})["token"]
    check("connexion avec le compte administrateur créé par variables d'environnement", True)
except Exception as e:
    check("connexion avec le compte administrateur", False, repr(e)); sys.exit(1)

try:
    tools = call("/api/v1/tools/", token=tok)
    ids = [t.get("id") for t in tools]
    check("outil de l'assistant visible (server:cluster-assistant)", "server:cluster-assistant" in ids, "ids=%r" % ids)
except Exception as e:
    check("liste des outils", False, repr(e))

try:
    models = call("/api/models", token=tok)["data"]
    m = next((x for x in models if x.get("id") == "qwen3:8b"), None)
    check("modèle qwen3:8b visible", m is not None, "ids=%r" % [x.get("id") for x in models])
    meta = ((m or {}).get("info") or {}).get("meta") or {}
    check("outil activé par défaut sur le modèle (toolIds)", "server:cluster-assistant" in (meta.get("toolIds") or []), "meta=%r" % meta)
    check("outils intégrés désactivés (capabilities.builtin_tools=false)", (meta.get("capabilities") or {}).get("builtin_tools") is False, "meta=%r" % meta)
    ws = call("/api/v1/models/model?id=qwen3%3A8b", token=tok) or {}
    wp = ws.get("params") or {}
    check("entrée de modèle avec prompt système et num_ctx (make local-webui-config)", wp.get("system", "").startswith("Tu es l") and wp.get("num_ctx") == 8192, "params=%r" % list(wp))
except Exception as e:
    check("liste des modèles", False, repr(e))
sys.exit(1 if bad else 0)
PY
[ $? -eq 0 ] || fail=1

echo ">> 6. Bout en bout : une question à l'agent (charge le modèle en mémoire : 30 s à 2 min)"
# Question du banc d'essai (top 3 mémoire), qui appelle l'outil de métriques. On ne juge pas la justesse de la réponse
# (le modèle n'est pas déterministe sur toute question) : on vérifie qu'une réponse est produite avec au moins un appel d'outil.
ans="$($K exec -i -n assistant deploy/assistant -- python - <<'PY' 2>&1
import json, urllib.request as u
r = u.Request('http://localhost:8000/ask', data=json.dumps({'question': 'Quels sont les 3 pods qui consomment le plus de mémoire ?'}).encode(), headers={'Content-Type': 'application/json'})
d = json.load(u.urlopen(r, timeout=600))
print(d['answer'])
print('OUTILS_APPELES', len(d['tool_calls']), [t['tool'] for t in d['tool_calls']])
PY
)"
if echo "$ans" | grep -qE "^OUTILS_APPELES [1-9]"; then ok "réponse de l'agent avec appel d'outil :"; else ko "pas de réponse exploitable :"; fi
echo "$ans" | sed 's/^/           /'

echo
if [ "$fail" -eq 0 ]; then echo "Tous les contrôles sont passés."; else echo "Au moins un contrôle a échoué."; exit 1; fi
