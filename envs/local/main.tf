terraform {
  required_version = ">= 1.5"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

provider "helm" {
  kubernetes {
    config_path    = var.kubeconfig_path
    config_context = "kind-k8s-ai-monitoring" # contexte créé par `kind create cluster --name k8s-ai-monitoring`
  }
}

# Phase 1 : Garage (S3 local). Le chart Garage n'est pas publié dans un dépôt Helm : il faut cloner
# https://git.deuxfleurs.fr/Deuxfleurs/garage et pointer vers garage/script/helm/garage (cf. Makefile).
resource "helm_release" "garage" {
  name             = "garage"
  namespace        = "garage"
  create_namespace = true
  chart            = var.garage_chart_path
  wait             = true
  timeout          = 600

  values = [yamlencode({
    garage = { singleNode = true }
    persistence = {
      meta = { size = "1Gi" }
      data = { size = "10Gi" }
    }
  })]
}

# Phase 2 : le reste de la stack, activé une fois les buckets/clé créés (scripts/garage-init.sh).
module "observability" {
  count  = var.deploy_stack ? 1 : 0
  source = "../../modules/observability"

  cluster_name = "kind-local"

  s3_endpoint   = var.s3_endpoint
  s3_region     = "garage"
  s3_insecure   = true
  s3_access_key = var.s3_access_key
  s3_secret_key = var.s3_secret_key
  bucket_prefix = ""

  grafana_admin_password = var.grafana_admin_password
  webui_secret_key       = var.webui_secret_key
  webui_admin_email      = var.webui_admin_email
  webui_admin_password   = var.webui_admin_password
  loki_caches_enabled    = false

  # Image construite sur le poste puis chargée dans Kind (make local-assistant-image) : pas de registre.
  assistant_image_repository  = "assistant"
  assistant_image_tag         = var.assistant_image_tag
  assistant_image_pull_policy = "IfNotPresent"

  depends_on = [helm_release.garage]
}
