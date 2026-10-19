variable "kubeconfig_path" {
  type    = string
  default = "~/.kube/config"
}

variable "garage_chart_path" {
  description = "Chemin local du chart Garage (garage/script/helm/garage dans le dépôt cloné)."
  type        = string
}

variable "deploy_stack" {
  description = "false = phase 1 (Garage seul). true = phase 2 (Mimir, Loki, k8s-monitoring, Grafana, Open WebUI)."
  type        = bool
  default     = false
}

variable "s3_endpoint" {
  description = "Service S3 de Garage. Nom de service à confirmer avec `kubectl get svc -n garage`."
  type        = string
  default     = "garage.garage.svc.cluster.local:3900"
}

variable "s3_access_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "s3_secret_key" {
  type      = string
  default   = ""
  sensitive = true
}

# Les secrets n'ont PAS de valeur par défaut : `make local-secrets` (scripts/gen-secrets.sh) les génère
# aléatoirement dans envs/local/secrets.auto.tfvars.json (ignoré par git, droits 600).
variable "grafana_admin_password" {
  type      = string
  sensitive = true
}

variable "webui_secret_key" {
  type      = string
  sensitive = true
}

variable "webui_admin_email" {
  type    = string
  default = "admin@local.invalid"
}

variable "webui_admin_password" {
  type      = string
  sensitive = true
}

variable "assistant_image_tag" {
  description = "Tag de l'image construite par `make local-assistant-image` (le Makefile le passe)."
  type        = string
  default     = "0.4.3"
}
