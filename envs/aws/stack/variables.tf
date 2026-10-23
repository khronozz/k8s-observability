variable "kubeconfig_path" {
  description = "Kubeconfig du cluster EKS, écrit par scripts/aws-up.sh (`aws eks update-kubeconfig`)."
  type        = string
  default     = "../../../.work/aws-kubeconfig"
}

variable "grafana_admin_password" {
  description = "Généré par scripts/aws-up.sh dans secrets.auto.tfvars.json (ignoré par Git)."
  type        = string
  sensitive   = true
}
