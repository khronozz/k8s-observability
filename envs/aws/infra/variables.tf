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

# ---- Hôte EC2 : assistant + Open WebUI (Docker Compose), hors du cluster surveillé ----

variable "host_instance_type" {
  description = "Type d'instance de l'hôte. t3.small (2 Gio) : Open WebUI occupait ~0,7 Gio sur Kind (relevé du 17.10.2026) ; mémoire de l'assistant, de Docker et du système NON mesurée sur AWS (docker stats et free -m au premier essai). t3.micro (1 Gio) jugé trop juste (estimation)."
  type        = string
  default     = "t3.small"
}

variable "assistant_image" {
  description = "Adresse complète de l'image de l'assistant (linux/amd64) dans le registre, ex. registry.forge.hefr.ch/<utilisateur>/k8s-observability/assistant:0.5.0."
  type        = string
}

variable "registry_host" {
  type    = string
  default = "registry.forge.hefr.ch"
}

variable "registry_username" {
  description = "Nom d'utilisateur du jeton de déploiement GitLab (portée read_registry), ex. gitlab+deploy-token-469."
  type        = string
}

variable "registry_token" {
  description = "Jeton de déploiement GitLab (read_registry). Jamais dans le dépôt : variable d'environnement TF_VAR_registry_token (scripts/aws-up.sh la lit dans .work/registry-token)."
  type        = string
  sensitive   = true
}

variable "webui_image" {
  description = "Image d'Open WebUI. Le module Kubernetes utilisait la version 0.12.0 ; l'existence de cette étiquette dans le registre n'est pas vérifiée."
  type        = string
  default     = "ghcr.io/open-webui/open-webui:v0.12.0"
}

variable "webui_admin_email" {
  type    = string
  default = "admin@g13-p5.local"
}

variable "bedrock_model_id" {
  description = "Modèle Bedrock appelé par l'assistant (appel Converse vérifié le 25.10.2026 avec cet identifiant)."
  type        = string
  default     = "mistral.mistral-large-3-675b-instruct"
}

variable "compose_version" {
  description = "Version du plugin Docker Compose installé sur l'hôte. Étiquette non vérifiée : à confirmer au premier essai."
  type        = string
  default     = "v2.29.7"
}
