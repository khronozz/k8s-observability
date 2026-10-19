variable "kubeconfig_path" {
  description = "Kubeconfig du cluster SCK (téléchargé depuis le portail)."
  type        = string
}

variable "cluster_name" {
  type    = string
  default = "switch-sck"
}

variable "s3_endpoint" {
  description = "Hôte de l'API SCS3, sans schéma. NON trouvé dans la doc consultée : à relever dans la documentation SCS3 / le portail."
  type        = string
}

variable "s3_region" {
  description = "Région à utiliser avec SCS3. NON trouvée dans la doc consultée."
  type        = string
}

variable "s3_access_key" {
  type      = string
  sensitive = true
}

variable "s3_secret_key" {
  type      = string
  sensitive = true
}

variable "bucket_prefix" {
  description = "Préfixe unique des buckets, ex: `hesso-g3-` (unicité globale probable sur un S3 partagé : à vérifier)."
  type        = string
}

variable "grafana_admin_password" {
  type      = string
  sensitive = true
}

variable "webui_secret_key" {
  type      = string
  sensitive = true
}

variable "loki_caches_enabled" {
  description = "Peut passer à true si les nœuds ont assez de RAM."
  type        = bool
  default     = false
}

variable "chart_versions" {
  type = object({
    mimir          = optional(string)
    loki           = optional(string)
    k8s_monitoring = optional(string)
    grafana        = optional(string)
    open_webui     = optional(string)
    ollama         = optional(string)
  })
  default = {}
}

variable "webui_admin_email" {
  type = string
}

variable "webui_admin_password" {
  type      = string
  sensitive = true
}

# --- LLM et assistant sur le cloud ---
variable "assistant_image_repository" {
  description = "Adresse complète de l'image de l'assistant dans un registre accessible depuis le cluster. Registre NON choisi à ce jour."
  type        = string
}

variable "assistant_image_tag" {
  type    = string
  default = "0.4.3"
}

variable "assistant_image_pull_secrets" {
  description = "Secrets dockerconfigjson du registre privé (à créer dans le namespace `assistant`)."
  type        = list(string)
  default     = []
}

variable "llm_model" {
  description = "Modèle Ollama. qwen3:8b = 6,7 Go de RAM mesurés avec un contexte de 8192 sur CPU : à confirmer sur les nœuds SCK."
  type        = string
  default     = "qwen3:8b"
}

variable "ollama_extra_values" {
  description = "Valeurs Helm supplémentaires du chart Ollama (GPU, resources, nodeSelector, storageClass...)."
  type        = any
  default     = {}
}
