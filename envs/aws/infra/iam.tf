# Option A (décision du 23.10.2026) : un utilisateur IAM dédié, limité aux six buckets, dont la clé est donnée à
# Mimir et Loki. La clé est dans l'état OpenTofu (jamais dans Git : .gitignore) ; la destruction la supprime.
resource "aws_iam_user" "s3" {
  name          = "${var.prefix}-s3-access"
  force_destroy = true
}

resource "aws_iam_access_key" "s3" {
  user = aws_iam_user.s3.name
}

data "aws_iam_policy_document" "s3" {
  statement {
    actions   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"]
    resources = [for b in aws_s3_bucket.data : b.arn]
  }
  statement {
    actions = [
      "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
      "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts",
    ]
    resources = [for b in aws_s3_bucket.data : "${b.arn}/*"]
  }
}

resource "aws_iam_user_policy" "s3" {
  name   = "${var.prefix}-s3-buckets"
  user   = aws_iam_user.s3.name
  policy = data.aws_iam_policy_document.s3.json
}
