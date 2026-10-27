#!/usr/bin/env bash
# Pose les questions de refus du plan de tests (S1, S2, S4, S6, S7) à l'assistant déployé sur l'hôte AWS, via SSM.
# Usage : scripts/aws-run-scenarios.sh [S1 S2 S4 S6 S7]     (défaut : ces cinq ; S1 est posé 3 fois, les autres 1 fois)
# Le script scripts/run_scenarios.py est copié dans le conteneur de l'assistant et interroge http://localhost:8000/ask :
# c'est le même agent que celui d'Open WebUI, sans passer par l'interface. Résultat : docs/tests/resultats/<date>-aws-refus.md
# Ce script ne JUGE rien : le jugement « réussi ou non » reste humain. Lecture seule côté cluster.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/aws-common.sh"
need aws; need python3; need base64; need "$TF"
check_aws
IDS=("$@"); [ "${#IDS[@]}" -gt 0 ] || IDS=(S1 S2 S4 S6 S7)
ID="$("$TF" -chdir="$INFRA_DIR" output -raw host_instance_id)"
OUT="$ROOT/docs/tests/resultats/$(date +%Y-%m-%d)-aws-refus.md"
mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
python3 - "$ROOT/scripts/run_scenarios.py" "$TMP" "${IDS[@]}" <<'PY'
import base64, json, sys
src, dest, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
b64 = base64.b64encode(open(src, "rb").read()).decode()
run = "docker compose exec -T assistant python /tmp/rs.py --stdout --label aws"
cmds = ["cd /opt/g13", f"echo {b64} | base64 -d > /tmp/rs.py", "docker compose cp /tmp/rs.py assistant:/tmp/rs.py"]
if "S1" in ids:
    cmds.append(f"{run} --repeat 3 S1")
rest = [i for i in ids if i != "S1"]
if rest:
    cmds.append(f"{run} --repeat 1 {' '.join(rest)}")
json.dump({"commands": cmds, "executionTimeout": ["1800"]}, open(dest, "w"))
PY
CMD="$(aws ssm send-command --region "$REGION" --instance-ids "$ID" --document-name AWS-RunShellScript \
  --parameters "file://$TMP" --query Command.CommandId --output text)"
echo ">> Questions envoyées à l'hôte (commande SSM $CMD). Attente du résultat (jusqu'à 20 min)..."
STATUS=InProgress
for _ in $(seq 1 120); do
  STATUS="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 10
done
RES="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" --query StandardOutputContent --output text)"
ERR="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" --query StandardErrorContent --output text)"
{ echo "# Résultats : aws, $(date +%Y-%m-%d), assistant en service sur l'hôte"; echo
  echo "Posés par \`scripts/aws-run-scenarios.sh\` ($(date +%H:%M)), via \`/ask\` sur l'hôte. La colonne « Jugement » est à remplir à la main."
  printf '%s\n' "$RES"; } >> "$OUT"
[ "${#RES}" -lt 23500 ] || echo "!! La sortie SSM est tronquée à 24 000 caractères : relancer scénario par scénario." >&2
echo ">> Statut SSM : $STATUS ; résultats écrits dans ${OUT#"$ROOT"/}"
[ "$STATUS" = Success ] || { echo "!! Erreurs : ${ERR:0:600}" >&2; exit 1; }
