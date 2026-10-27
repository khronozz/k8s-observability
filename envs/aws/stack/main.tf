# Pile d'observabilité dans EKS : Mimir, Loki, Alloy (k8s-monitoring) et Grafana. Pas d'Ollama, d'assistant ni
# d'Open WebUI dans le cluster (exigence du professeur) : ils tournent sur l'instance EC2 (étape suivante).
# Deux environnements séparés (infra puis stack) car le fournisseur Helm a besoin d'un cluster déjà créé.

data "terraform_remote_state" "infra" {
  backend = "local"
  config = {
    path = "${path.module}/../infra/terraform.tfstate"
  }
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

module "observability" {
  source = "../../../modules/observability"

  cluster_name = data.terraform_remote_state.infra.outputs.cluster_name

  # Amazon S3 : point d'accès régional, HTTPS. Les clés viennent de l'utilisateur IAM de envs/aws/infra.
  s3_endpoint   = "s3.${data.terraform_remote_state.infra.outputs.region}.amazonaws.com"
  s3_region     = data.terraform_remote_state.infra.outputs.region
  s3_insecure   = false
  s3_access_key = data.terraform_remote_state.infra.outputs.s3_access_key
  s3_secret_key = data.terraform_remote_state.infra.outputs.s3_secret_key
  bucket_prefix = data.terraform_remote_state.infra.outputs.bucket_prefix

  grafana_admin_password = var.grafana_admin_password
  loki_caches_enabled    = false
  helm_wait              = false # le script aws-up.sh attend l'état réel des pods (voir variables.tf du module)

  deploy_chat_stack  = false
  gateway_node_ports = data.terraform_remote_state.infra.outputs.gateway_node_ports
}
