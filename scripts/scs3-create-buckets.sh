#!/usr/bin/env bash
# Crée les 6 buckets sur Switch Cloud S3 (SCS3) avec l'AWS CLI.
# NON TESTÉ : la doc SCS3 consultée dit que le service est accessible via des clients compatibles S3 (AWS CLI, Rclone),
# mais ne donne ni l'URL du endpoint, ni la procédure d'obtention des clés, ni la région (pages "User Authentication" et
# "Create an S3 Bucket" non lues). Renseignez ces valeurs depuis la doc/portail.
#
# Usage : S3_ENDPOINT_URL=https://... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... BUCKET_PREFIX=monprefixe- ./scs3-create-buckets.sh
set -euo pipefail
: "${S3_ENDPOINT_URL:?URL complète du endpoint SCS3 (avec https://)}"
: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"
PREFIX="${BUCKET_PREFIX:?préfixe unique, ex: hesso-g3-}"

for b in mimir-blocks mimir-alertmanager mimir-ruler loki-chunks loki-ruler loki-admin; do
  echo ">> ${PREFIX}${b}"
  aws s3api create-bucket --bucket "${PREFIX}${b}" --endpoint-url "$S3_ENDPOINT_URL"
done
