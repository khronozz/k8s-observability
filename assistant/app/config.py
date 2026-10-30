"""Configuration par variables d'environnement (aucun secret : Mimir et Loki sont sans authentification
dans ce déploiement, auth_enabled=false)."""
import os

# URLs des services du cluster (valeurs par défaut = noms DNS vérifiés sur Kind le 15.10.2026).
MIMIR_URL = os.getenv("MIMIR_URL", "http://mimir-gateway.mimir.svc.cluster.local/prometheus")
LOKI_URL = os.getenv("LOKI_URL", "http://loki-gateway.loki.svc.cluster.local")

# Garde-fous : l'assistant est en LECTURE SEULE et ne doit pas pouvoir saturer Mimir/Loki.
HTTP_TIMEOUT_S = float(os.getenv("HTTP_TIMEOUT_S", "20"))
MAX_LOG_LINES = int(os.getenv("MAX_LOG_LINES", "200"))      # plafond dur, quel que soit `limit` demandé
MAX_RANGE_HOURS = int(os.getenv("MAX_RANGE_HOURS", "24"))   # fenêtre maximale d'une requête
MAX_SERIES = int(os.getenv("MAX_SERIES", "50"))             # séries renvoyées au plus (le reste est compté)

# ---- Fournisseur du modèle de langage ----
# « ollama » (défaut, comportement historique : modèle local sur Kind) ou « bedrock » (Amazon Bedrock, AWS).
# Avec « bedrock », aucune clé n'est lue ici : boto3 cherche lui-même les identifiants (rôle IAM de l'instance EC2,
# ou profil/variables AWS en développement). Aucun secret dans l'image ni dans les fichiers du dépôt.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
# Mistral Large 3 : appel d'outils vérifié sur le compte du projet le 22.10.2026 (un seul essai, stopReason=tool_use).
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "mistral.mistral-large-3-675b-instruct")
BEDROCK_REGION = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
# Plafond de génération par appel (Bedrock seulement) : la consigne demande 120 mots au plus (~200 tokens) ;
# 600 laisse de la marge pour les arguments d'outils. Valeur choisie, non mesurée.
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "600"))
# Nom du « modèle » que l'interface compatible OpenAI (/v1) présente à Open WebUI.
PUBLIC_MODEL_NAME = os.getenv("PUBLIC_MODEL_NAME", "assistant-kubernetes")

# ---- Agent (Ollama) ----
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama.ollama.svc.cluster.local:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:8b")
# Raisonnement du modèle : mesuré sur Kind (16.10.2026), il triple la durée d'une réponse courte
# (339 tokens contre 113). Désactivé par défaut ; à activer si la qualité des requêtes l'exige.
LLM_REASONING = os.getenv("LLM_REASONING", "false").lower() == "true"
LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "8192"))
AGENT_MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "6"))   # appels modèle/outils au plus par question
# Caractères du résultat de chaque outil recopiés dans la réponse (`tool_calls[].result`) pour vérifier ce que l'agent a vu.
# 0 = désactivé. Attention : Open WebUI renvoie toute la réponse au modèle (second passage), donc chaque
# caractère ajouté allonge ce passage ; l'effet sur la latence n'est pas mesuré.
TRACE_RESULT_CHARS = int(os.getenv("TRACE_RESULT_CHARS", "600"))

# URL absolue sous laquelle Open WebUI (backend, dans le cluster) joint la sous-application d'outils ; elle figure
# dans la spécification OpenAPI (champ `servers`) pour ne pas dépendre de la résolution d'une URL relative.
TOOLS_PUBLIC_URL = os.getenv("TOOLS_PUBLIC_URL", "http://assistant.assistant.svc.cluster.local:8000/tools")
