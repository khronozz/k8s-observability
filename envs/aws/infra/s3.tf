# Six buckets : trois pour Mimir, trois pour Loki (les mêmes noms que le module d'observabilité attend, derrière
# bucket_prefix). Les noms de bucket sont uniques dans le monde entier : suffixe aléatoire de 6 caractères.
resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  bucket_prefix = "${var.prefix}-${random_id.suffix.hex}-"
  bucket_names = [
    "mimir-blocks", "mimir-alertmanager", "mimir-ruler",
    "loki-chunks", "loki-ruler", "loki-admin",
  ]
}

resource "aws_s3_bucket" "data" {
  for_each = toset(local.bucket_names)
  bucket   = "${local.bucket_prefix}${each.value}"
  # ATTENTION : force_destroy = true, la destruction supprime AUSSI le contenu des buckets (preuve de concept).
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "data" {
  for_each                = aws_s3_bucket.data
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
