variable "cluster_name" {
  description = "Nom logique du cluster (label `cluster` ajouté aux métriques/logs)."
  type        = string
}

# --- Stockage objet (S3-compatible) utilisé par Mimir et Loki -------------------------
variable "s3_endpoint" {
  description = "Hôte:port de l'API S3, SANS schéma (ex: garage.garage.svc.cluster.local:3900)."
  type        = string
}

variable "s3_region" {
  description = "Région S3 (Garage: `garage`, valeur par défaut de s3_region dans garage.toml)."
  type        = string
}

variable "s3_insecure" {
  description = "true = HTTP sans TLS (cas Garage dans le cluster), false = HTTPS."
  type        = bool
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
  description = "Préfixe des noms de buckets (utile sur un S3 partagé où les noms doivent être uniques)."
  type        = string
  default     = ""
}

# --- Applications -------------------------------------------------------------------
variable "grafana_admin_password" {
  type      = string
  sensitive = true
}

variable "deploy_chat_stack" {
  description = "true (local, Kind) : Ollama, l'assistant et Open WebUI sont installés DANS le cluster. false (AWS) : seuls Mimir, Loki, Alloy et Grafana sont installés ; l'assistant et Open WebUI tournent hors du cluster (instance EC2)."
  type        = bool
  default     = true
}

variable "webui_secret_key" {
  description = "WEBUI_SECRET_KEY d'Open WebUI (générer avec `openssl rand -hex 32`)."
  type        = string
  sensitive   = true
  default     = "" # inutile si deploy_chat_stack = false
}

variable "loki_caches_enabled" {
  description = "false en local : les caches memcached du chart Loki consomment beaucoup de RAM."
  type        = bool
  default     = false
}

# --- Versions des charts. Valeurs par défaut = versions installées et vérifiées sur Kind le 15.10.2026.
# (relevées avec `helm list -A`). ---
variable "chart_versions" {
  type = object({
    mimir          = optional(string, "6.2.1")
    loki           = optional(string, "18.15.1")
    k8s_monitoring = optional(string, "4.5.3")
    grafana        = optional(string, "14.0.0")
    open_webui     = optional(string, "17.0.0")
    ollama         = optional(string, "1.88.0")
  })
  default = {}
}

# --- LLM local (Ollama) et assistant -------------------------------------------------------
variable "llm_model" {
  description = "Modèle Ollama téléchargé au démarrage du pod et utilisé par l'assistant et par Open WebUI."
  type        = string
  default     = "qwen3:8b"
}

variable "llm_num_ctx" {
  description = "Fenêtre de contexte demandée à Ollama (8192 : valeur mesurée sur Kind, ~6,7 Go de RAM pour qwen3:8b)."
  type        = number
  default     = 8192
}

variable "ollama_storage_size" {
  description = "Taille du volume des modèles (qwen3:8b = 5,2 Go ; 30Gi = valeur de l'installation manuelle)."
  type        = string
  default     = "30Gi"
}

variable "ollama_storage_class" {
  description = "StorageClass du volume Ollama. Vide = classe par défaut du cluster."
  type        = string
  default     = ""
}

variable "ollama_extra_values" {
  description = "Valeurs Helm supplémentaires pour le chart Ollama, fusionnées après les valeurs de base (GPU, resources, nodeSelector...)."
  type        = any
  default     = {}
}

variable "ollama_timeout_seconds" {
  description = "Durée maximale d'attente d'Ollama : le pod n'est prêt qu'après le téléchargement du modèle."
  type        = number
  default     = 1800
}

variable "webui_timeout_seconds" {
  description = <<-EOT
    Durée maximale d'attente d'Open WebUI. Mesuré le 19.10.2026 (Kind local, téléchargements en parallèle) : le
    téléchargement de l'image (1,46 Go) a duré 12 min 44 s, puis le démarrage (modèle d'embedding téléchargé depuis
    Hugging Face) environ 1 à 2 min ; avec l'ancienne valeur de 600 s, le déploiement échouait avec « context deadline exceeded »
    alors que le pod est devenu prêt ensuite. 1800 s laisse une marge d'environ le double de la durée mesurée.
  EOT
  type        = number
  default     = 1800
}

variable "assistant_image_repository" {
  description = "Image de l'assistant. Local : `assistant` (chargée dans Kind). Cloud : adresse complète dans un registre."
  type        = string
  default     = "assistant"
}

variable "assistant_image_tag" {
  type    = string
  default = "0.4.3"
}

variable "assistant_image_pull_policy" {
  type    = string
  default = "IfNotPresent"
}

variable "assistant_image_pull_secrets" {
  description = "Noms de Secrets Kubernetes (type dockerconfigjson) pour un registre privé. Ils doivent exister dans le namespace `assistant`."
  type        = list(string)
  default     = []
}

# --- Compte administrateur d'Open WebUI (créé au premier démarrage) ----------------------------------
variable "webui_admin_email" {
  type    = string
  default = "" # inutile si deploy_chat_stack = false ; une précondition l'exige sinon (main.tf)
}

variable "webui_admin_name" {
  type    = string
  default = "Admin"
}

variable "webui_admin_password" {
  type      = string
  sensitive = true
  default   = "" # voir webui_admin_email
}

variable "gateway_node_ports" {
  description = "Ports NodePort des passerelles Mimir et Loki (plage 30000-32767). Vide (null) : les passerelles restent en ClusterIP (local). Sur AWS, l'instance EC2 qui héberge l'assistant les joint par l'adresse privée d'un nœud ; seul son groupe de sécurité y est autorisé (envs/aws/infra)."
  type = object({
    mimir = optional(number)
    loki  = optional(number)
  })
  default = {}
}

variable "helm_wait" {
  description = <<-EOT
    true (défaut, comportement historique) : OpenTofu attend que Mimir, Loki, Alloy et Grafana soient prêts, dans la limite
    du délai de chaque version. false : OpenTofu rend la main dès l'installation lancée, et c'est le script (scripts/aws-up.sh)
    qui attend l'état réel des pods. Intérêt : un délai dépassé marque la version « failed » dans l'état OpenTofu alors que les
    pods finissent par démarrer (constaté le 24.10.2026), et la relance détruit puis recrée ces versions.
  EOT
  type        = bool
  default     = true
}
