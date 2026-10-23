variable "region" {
  type    = string
  default = "us-east-1"
}

variable "prefix" {
  description = "Préfixe de toutes les ressources : g13 = groupe 13, p5 = projet 5."
  type        = string
  default     = "g13-p5"
}

variable "kubernetes_version" {
  description = "Version de Kubernetes d'EKS, sans valeur par défaut : à choisir parmi celles que propose AWS (`aws eks describe-cluster-versions`)."
  type        = string
}

variable "node_instance_type" {
  type    = string
  default = "m5.xlarge"
}

variable "node_count" {
  type    = number
  default = 2
}

variable "admin_cidrs" {
  description = "Adresses autorisées à joindre l'API Kubernetes et Open WebUI, au format CIDR (ex. [\"203.0.113.7/32\"]). Jamais 0.0.0.0/0."
  type        = list(string)
  validation {
    condition     = length(var.admin_cidrs) > 0 && !contains(var.admin_cidrs, "0.0.0.0/0")
    error_message = "admin_cidrs doit contenir au moins une adresse et ne doit pas contenir 0.0.0.0/0."
  }
}

variable "gateway_node_ports" {
  description = "Ports NodePort des passerelles Mimir et Loki ; ils doivent être les mêmes dans envs/aws/stack."
  type = object({
    mimir = number
    loki  = number
  })
  default = {
    mimir = 30090
    loki  = 30310
  }
}
