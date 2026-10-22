# LLM local (Ollama) et assistant de supervision.
#
# Choix : le LLM tourne DANS le cluster pour que les données de supervision (potentiellement médicales dans le
# contexte du projet) ne quittent pas l'infrastructure.

locals {
  ollama_url = "http://ollama.ollama.svc.cluster.local:11434"

  # Adresse sous laquelle Open WebUI (dans le cluster) joint la sous-application d'outils de l'assistant.
  # Doit rester identique à `toolsPublicUrl` du chart de l'assistant (valeur par défaut du chart).
  assistant_tools_url = "http://assistant.assistant.svc.cluster.local:8000/tools"
}

# Ollama (chart otwld/ollama). Les valeurs de l'installation manuelle étaient : persistentVolume.enabled=true, size=30Gi.
# Le modèle est téléchargé par le chart lui-même (`ollama.models.pull`, crochet postStart du conteneur) :
# l'étape manuelle `ollama pull` disparaît. Conséquence : le pod n'est « prêt » qu'après le téléchargement
# (5,2 Go pour qwen3:8b), d'où le délai d'attente élevé.
# NON TESTÉ : clés lues dans le values.yaml et le template du dépôt otwld/ollama-helm (branche main, pas forcément
# la version 1.88.0) ; à confirmer avec `make check-charts`.
resource "helm_release" "ollama" {
  count            = var.deploy_chat_stack ? 1 : 0
  name             = "ollama"
  namespace        = "ollama"
  create_namespace = true
  repository       = "https://helm.otwld.com/"
  chart            = "ollama"
  version          = var.chart_versions.ollama
  timeout          = var.ollama_timeout_seconds
  wait             = true

  values = [
    yamlencode({
      persistentVolume = merge(
        { enabled = true, size = var.ollama_storage_size },
        var.ollama_storage_class == "" ? {} : { storageClass = var.ollama_storage_class },
      )
      ollama = {
        models = { pull = [var.llm_model] }
      }
    }),
    # Fusionné APRÈS par Helm (ordre de la liste) : GPU, ressources, nodeSelector...
    yamlencode(var.ollama_extra_values),
  ]
}

# Assistant : chart local `charts/assistant` (même mécanisme helm_release que le reste : un seul fournisseur OpenTofu).
# L'image n'est PAS construite par OpenTofu : en local `make local-assistant-image` la construit et la charge dans
# Kind ; sur le cloud elle doit avoir été poussée dans un registre (variable assistant_image_repository).
resource "helm_release" "assistant" {
  count            = var.deploy_chat_stack ? 1 : 0
  name             = "assistant"
  namespace        = "assistant"
  create_namespace = true
  chart            = "${path.module}/../../charts/assistant"
  timeout          = 300
  wait             = true

  values = [yamlencode({
    image = {
      repository = var.assistant_image_repository
      tag        = var.assistant_image_tag
      pullPolicy = var.assistant_image_pull_policy
    }
    imagePullSecrets = [for name in var.assistant_image_pull_secrets : { name = name }]
    mimirUrl         = "http://${local.mimir_gateway}/prometheus"
    lokiUrl          = "http://${local.loki_gateway}"
    ollamaUrl        = local.ollama_url
    toolsPublicUrl   = local.assistant_tools_url
    llm = {
      model     = var.llm_model
      reasoning = "false"
      numCtx    = tostring(var.llm_num_ctx)
    }
  })]

  # L'assistant interroge Mimir et Loki à chaque question ; son démarrage (sonde /health) n'en dépend pas, mais
  # ce lien garantit qu'un `apply` réussi laisse un système utilisable.
  depends_on = [helm_release.mimir, helm_release.loki]
}

# Les ressources ci-dessus sont devenues conditionnelles (count) : ces blocs évitent qu'un état existant
# les détruise puis les recrée. Sans effet sur un état neuf.
moved {
  from = helm_release.ollama
  to   = helm_release.ollama[0]
}

moved {
  from = helm_release.assistant
  to   = helm_release.assistant[0]
}
