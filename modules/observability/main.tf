locals {
  bucket = {
    mimir_blocks       = "${var.bucket_prefix}mimir-blocks"
    mimir_alertmanager = "${var.bucket_prefix}mimir-alertmanager"
    mimir_ruler        = "${var.bucket_prefix}mimir-ruler"
    loki_chunks        = "${var.bucket_prefix}loki-chunks"
    loki_ruler         = "${var.bucket_prefix}loki-ruler"
    loki_admin         = "${var.bucket_prefix}loki-admin"
  }

  # Noms de services internes (à vérifier avec `kubectl get svc -A` après installation).
  mimir_gateway = "mimir-gateway.mimir.svc.cluster.local"
  loki_gateway  = "loki-gateway.loki.svc.cluster.local"
}

# Dépôt `grafana` : mimir-distributed, k8s-monitoring.
# Dépôt `grafana-community` : loki (confirmé par la doc Loki), grafana (vu dans l'index du dépôt communautaire).
resource "helm_release" "mimir" {
  name             = "mimir"
  namespace        = "mimir"
  create_namespace = true
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "mimir-distributed"
  version          = var.chart_versions.mimir
  timeout          = 900
  wait             = true

  values = [templatefile("${path.module}/values/mimir.yaml.tftpl", {
    s3_endpoint   = var.s3_endpoint
    s3_region     = var.s3_region
    s3_insecure   = var.s3_insecure
    s3_access_key = var.s3_access_key
    s3_secret_key = var.s3_secret_key
    bucket        = local.bucket
  })]
}

resource "helm_release" "loki" {
  name             = "loki"
  namespace        = "loki"
  create_namespace = true
  repository       = "https://grafana-community.github.io/helm-charts"
  chart            = "loki"
  version          = var.chart_versions.loki
  timeout          = 900
  wait             = true

  values = [templatefile("${path.module}/values/loki.yaml.tftpl", {
    s3_endpoint    = var.s3_endpoint
    s3_region      = var.s3_region
    s3_insecure    = var.s3_insecure
    s3_access_key  = var.s3_access_key
    s3_secret_key  = var.s3_secret_key
    bucket         = local.bucket
    caches_enabled = var.loki_caches_enabled
  })]
}

resource "helm_release" "k8s_monitoring" {
  name             = "k8s-monitoring"
  namespace        = "monitoring"
  create_namespace = true
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "k8s-monitoring"
  version          = var.chart_versions.k8s_monitoring
  timeout          = 900
  wait             = true

  values = [templatefile("${path.module}/values/k8s-monitoring.yaml.tftpl", {
    cluster_name  = var.cluster_name
    mimir_gateway = local.mimir_gateway
    loki_gateway  = local.loki_gateway
  })]

  depends_on = [helm_release.mimir, helm_release.loki]
}

resource "helm_release" "grafana" {
  name             = "grafana"
  namespace        = "grafana"
  create_namespace = true
  repository       = "https://grafana-community.github.io/helm-charts"
  chart            = "grafana"
  version          = var.chart_versions.grafana
  timeout          = 600
  wait             = true

  values = [templatefile("${path.module}/values/grafana.yaml.tftpl", {
    admin_password = var.grafana_admin_password
    mimir_gateway  = local.mimir_gateway
    loki_gateway   = local.loki_gateway
  })]

  depends_on = [helm_release.mimir, helm_release.loki]
}

# Open WebUI. Tous les réglages faits à la main dans l'interface lors de l'installation manuelle sont posés ici par
# variables d'environnement (lues dans le code d'Open WebUI v0.12.0, config.py / env.py / main.py) :
#  - WEBUI_ADMIN_EMAIL / _PASSWORD / _NAME : compte administrateur créé au premier démarrage si aucun utilisateur
#    n'existe ; Open WebUI désactive alors l'inscription (ui.enable_signup=false).
#  - TOOL_SERVER_CONNECTIONS : connexion au serveur d'outils OpenAPI de l'assistant. `info.id` fixe l'identifiant
#    (`server:cluster-assistant`) au lieu de `server:0`, indice dépendant de l'ordre de la liste.
#  - DEFAULT_MODEL_PARAMS : contexte num_ctx appliqué à tous les modèles. Le PROMPT SYSTÈME, lui, n'est pas posé ici :
#    dans la v0.12.0 il n'est appliqué que par une entrée de modèle de l'espace de travail (utils/chat.py), créée par
#    scripts/webui-bootstrap.sh. Constaté le 18.10.2026 : avec DEFAULT_MODEL_PARAMS seul, le prompt n'était pas suivi.
#  - DEFAULT_MODEL_METADATA : capacité « Outils intégrés » désactivée, et outil de l'assistant activé par défaut dans
#    chaque nouvelle conversation (`toolIds`, lu par l'interface au choix du modèle).
#  - ENABLE_*_GENERATION=false : titres, étiquettes et suggestions de suite lancent d'autres générations sur le CPU,
#    ce qui retarde les réponses.
# Limite : ces variables ne servent que de VALEURS INITIALES (configuration persistante d'Open WebUI,
# ENABLE_PERSISTENT_CONFIG=true par défaut) : une fois la base créée, modifier la valeur ici ne change plus rien.
# Pour réappliquer, supprimer le volume d'Open WebUI (perte des comptes et conversations).
# NON TESTÉ : formats lus dans le code, jamais exécutés.
locals {
  webui_tool_id = "cluster-assistant"

  webui_env = {
    WEBUI_SECRET_KEY     = var.webui_secret_key
    WEBUI_ADMIN_EMAIL    = var.webui_admin_email
    WEBUI_ADMIN_NAME     = var.webui_admin_name
    WEBUI_ADMIN_PASSWORD = var.webui_admin_password
    ENABLE_SIGNUP        = "false"

    TOOL_SERVER_CONNECTIONS = jsonencode([{
      url       = local.assistant_tools_url
      path      = "openapi.json"
      type      = "openapi"
      auth_type = "none"
      key       = ""
      config    = { enable = true }
      info = {
        id          = local.webui_tool_id
        name        = "Assistant Kubernetes"
        description = "Interroge Mimir (métriques) et Loki (logs) en lecture seule."
      }
    }])

    DEFAULT_MODELS = var.llm_model
    DEFAULT_MODEL_PARAMS = jsonencode({
      num_ctx = var.llm_num_ctx
    })
    DEFAULT_MODEL_METADATA = jsonencode({
      capabilities = { builtin_tools = false }
      toolIds      = ["server:${local.webui_tool_id}"]
    })

    ENABLE_TITLE_GENERATION     = "false"
    ENABLE_TAGS_GENERATION      = "false"
    ENABLE_FOLLOW_UP_GENERATION = "false"
  }
}

resource "helm_release" "open_webui" {
  name             = "open-webui"
  namespace        = "open-webui"
  create_namespace = true
  repository       = "https://helm.openwebui.com/"
  chart            = "open-webui"
  version          = var.chart_versions.open_webui
  timeout          = var.webui_timeout_seconds
  wait             = true

  # yamlencode plutôt qu'un modèle de texte : le JSON et le prompt contiennent des guillemets et des apostrophes
  # qui seraient fragiles à échapper à la main dans du YAML.
  values = [yamlencode({
    # Clés et défauts vérifiés dans le values.yaml du chart 17.0.0 : ollama.enabled (true par défaut),
    # pipelines.enabled (true), websocket.enabled (true, redis), enableOpenaiApi (true), persistence, service.
    ollama    = { enabled = false } # Ollama est installé séparément (llm.tf)
    pipelines = { enabled = false }
    # Une seule réplique. Selon le guide Kubernetes d'Open WebUI (13.10.2026) : websocket activé, sans gestionnaire
    # ni Redis (Redis n'est requis qu'avec plusieurs répliques).
    websocket       = { enabled = true, manager = "", redis = { enabled = false } }
    enableOpenaiApi = false
    ollamaUrls      = [local.ollama_url]
    persistence     = { enabled = true, size = "2Gi" }
    service         = { type = "ClusterIP", port = 80 }
    extraEnvVars    = [for name, value in local.webui_env : { name = name, value = value }]
  })]

  # Open WebUI lit la spécification de l'assistant au démarrage : l'assistant doit déjà répondre.
  # Pas de dépendance à Ollama : le téléchargement du modèle (long) ne doit pas retarder Open WebUI.
  depends_on = [helm_release.assistant]
}
