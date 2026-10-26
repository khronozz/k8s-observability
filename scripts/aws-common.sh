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

# Variable obligatoire registry_token : lue dans .work/registry-token si le fichier existe. À la destruction, sa valeur
# n'a aucun effet mais OpenTofu exige qu'elle soit définie : à défaut de fichier on met un texte sans valeur.
load_registry_token_for_destroy() {
  if [ -s "$WORK/registry-token" ]; then
    TF_VAR_registry_token="$(tr -d '\n\r ' < "$WORK/registry-token")"
  else
    TF_VAR_registry_token=inutile
  fi
  export TF_VAR_registry_token
}

# Masque ce qui ne doit pas rester dans un terminal, un journal ou une capture : clés d'accès, secrets et numéro de compte.
# À placer après chaque appel tofu apply / destroy. Avec pipefail, l'échec de tofu reste visible.
mask_output() {
  perl -pe 'BEGIN{$|=1}
    s/((?:access_?key_?id|secret_?access_?key)\s*=\s*)"[^"]*"/$1"<masqué>"/ig;
    s/AKIA[0-9A-Z]{16}/<CLÉ>/g;
    s/(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/<COMPTE>/g'
}
