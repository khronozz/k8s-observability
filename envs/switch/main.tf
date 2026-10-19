terraform {
  required_version = ">= 1.5"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

# Le cluster SCK (Kubernetes managé de Switch Cloud) est créé HORS OpenTofu : portail ou API KKP
# (cf. scripts/sck-create-cluster.sh). On récupère ensuite son kubeconfig.
provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

module "observability" {
  source = "../../modules/observability"

  cluster_name = var.cluster_name

  s3_endpoint   = var.s3_endpoint
  s3_region     = var.s3_region
  s3_insecure   = false
  s3_access_key = var.s3_access_key
  s3_secret_key = var.s3_secret_key
  bucket_prefix = var.bucket_prefix

  grafana_admin_password = var.grafana_admin_password
  webui_secret_key       = var.webui_secret_key
  webui_admin_email      = var.webui_admin_email
  webui_admin_password   = var.webui_admin_password
  loki_caches_enabled    = var.loki_caches_enabled
  chart_versions         = var.chart_versions

  llm_model                    = var.llm_model
  ollama_extra_values          = var.ollama_extra_values
  assistant_image_repository   = var.assistant_image_repository
  assistant_image_tag          = var.assistant_image_tag
  assistant_image_pull_secrets = var.assistant_image_pull_secrets
}
