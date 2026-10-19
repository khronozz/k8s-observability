#!/usr/bin/env bash
# Initialise Garage (S3 local) : layout, buckets, clé d'accès. Écrit envs/local/s3.auto.tfvars.json.
#
# Exécuté avec succès le 18.10.2026 sur Kind (Garage v2.4.1) : le format de sortie de `garage key create`
# (« Key ID: », « Secret key: ») est bien celui attendu. Le script s'arrête si l'extraction échoue.
set -euo pipefail

NS=garage
POD=garage-0
PREFIX="${BUCKET_PREFIX:-}"
KEY_NAME="${KEY_NAME:-observability-key}"
OUT="$(dirname "$0")/../envs/local/s3.auto.tfvars.json"

g() { kubectl exec -n "$NS" "$POD" -c garage -- ./garage "$@"; }

echo ">> Etat de Garage"
g status

# OBSERVÉ sur Kind (Garage v2.4.1, chart avec garage.singleNode=true) : le layout est appliqué
# automatiquement, aucune commande `layout` n'est nécessaire. On ne tente donc plus l'assignation ;
# si `garage status` ne montre pas le nœud comme assigné, faites-le à la main (garage layout assign/apply).

BUCKETS=(
  "${PREFIX}mimir-blocks" "${PREFIX}mimir-alertmanager" "${PREFIX}mimir-ruler"
  "${PREFIX}loki-chunks"  "${PREFIX}loki-ruler"        "${PREFIX}loki-admin"
)

echo ">> Création de la clé ${KEY_NAME}"
KEY_OUT="$(g key create "$KEY_NAME")"
echo "$KEY_OUT" | sed 's/^Secret key:.*/Secret key:          (masquée)/'
ACCESS_KEY="$(echo "$KEY_OUT" | sed -n 's/^Key ID:[[:space:]]*//p' | head -n1)"
SECRET_KEY="$(echo "$KEY_OUT" | sed -n 's/^Secret key:[[:space:]]*//p' | head -n1)"
if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
  echo "Format de sortie inattendu : relevez Key ID / Secret key à la main et créez $OUT." >&2
  exit 1
fi

for b in "${BUCKETS[@]}"; do
  echo ">> Bucket $b"
  g bucket create "$b"
  g bucket allow --read --write --owner "$b" --key "$KEY_NAME"
done

umask 077
cat > "$OUT" <<EOF
{ "s3_access_key": "$ACCESS_KEY", "s3_secret_key": "$SECRET_KEY" }
EOF
echo ">> Identifiants écrits dans $OUT (fichier ignoré par git)."
