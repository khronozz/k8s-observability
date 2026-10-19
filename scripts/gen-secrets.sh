#!/usr/bin/env bash
# Génère les secrets de l'application dans <env>/secrets.auto.tfvars.json (ignoré par git, droits 600).
# Usage : scripts/gen-secrets.sh envs/local   (ou envs/switch)
#
# Choix : des valeurs ALÉATOIRES générées à la demande plutôt que des mots de passe écrits dans le dépôt ou
# tapés à la main ; le fichier n'est jamais écrasé (un nouveau mot de passe administrateur ne serait de toute
# façon pas appliqué à un Open WebUI déjà initialisé, cf. modules/observability/main.tf).
# Les identifiants du stockage S3 ne sont PAS générés ici : en local ils viennent de garage-init.sh, sur le cloud
# du fournisseur (SCS3).
set -euo pipefail

ENV_DIR="${1:?usage: $0 <envs/local|envs/switch>}"
OUT="$ENV_DIR/secrets.auto.tfvars.json"

if [ -f "$OUT" ]; then
  echo ">> $OUT existe déjà : conservé tel quel."
  exit 0
fi

command -v openssl >/dev/null || { echo "openssl est requis." >&2; exit 1; }

# Mot de passe lisible : base64 sans les caractères ambigus pour un shell ou une URL.
pw() { openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24; }

umask 077
cat > "$OUT" <<JSON
{
  "grafana_admin_password": "$(pw)",
  "webui_admin_password": "$(pw)",
  "webui_secret_key": "$(openssl rand -hex 32)"
}
JSON
echo ">> Secrets générés dans $OUT (droits 600, ignoré par git). Ne pas les copier dans un message ni dans le dépôt."
