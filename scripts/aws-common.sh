#!/usr/bin/env bash
# Fonctions communes aux scripts aws-*.sh (à sourcer, pas à exécuter).
# Convention de nommage et d'étiquettes : voir envs/aws/infra/versions.tf (préfixe g13-p5, groupe 13, projet 5).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF="${TF:-tofu}"
REGION="${AWS_REGION:-us-east-1}"
PREFIX="g13-p5"
INFRA_DIR="$ROOT/envs/aws/infra"
STACK_DIR="$ROOT/envs/aws/stack"
WORK="$ROOT/.work"
KUBECONFIG_FILE="$WORK/aws-kubeconfig"
CIDR_FILE="$WORK/admin-cidrs.txt"   # adresses d'administration connues, une par ligne (ignoré par Git)

export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

need() { command -v "$1" >/dev/null || { echo "Outil manquant : $1" >&2; exit 1; }; }

# Vérifie les identifiants AWS sans afficher le numéro de compte.
check_aws() {
  need aws
  local arn
  arn="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)" || {
    echo "Identifiants AWS absents ou invalides (aws sts get-caller-identity a échoué)." >&2; exit 1; }
  echo ">> Identité AWS : ${arn##*:} (région $REGION)"   # ${arn##*:} retire « arn:aws:iam::<compte>: »
}

# Ajoute l'adresse IPv4 publique actuelle à la liste connue et régénère admin.auto.tfvars.json.
# --reset : repart de l'adresse actuelle seule.
update_admin_cidrs() {
  need curl
  mkdir -p "$WORK"
  local ip
  ip="$(curl -fsS -m 10 https://checkip.amazonaws.com | tr -d '\n')" || { echo "Adresse IP publique introuvable." >&2; exit 1; }
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Adresse non IPv4 : '$ip' (IPv6 non géré)." >&2; exit 1; }
  if [ "${1:-}" = "--reset" ]; then : > "$CIDR_FILE"; fi
  touch "$CIDR_FILE"
  grep -qx "$ip/32" "$CIDR_FILE" || echo "$ip/32" >> "$CIDR_FILE"
  python3 - "$CIDR_FILE" "$INFRA_DIR/admin.auto.tfvars.json" <<'PY'
import json, sys
cidrs = [l.strip() for l in open(sys.argv[1]) if l.strip()]
json.dump({"admin_cidrs": cidrs}, open(sys.argv[2], "w"))
PY
  echo ">> Adresses d'administration autorisées : $(paste -sd' ' "$CIDR_FILE")"
}
