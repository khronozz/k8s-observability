"""Agent LangGraph en LECTURE SEULE : le modèle (Ollama) choisit parmi des outils qui n'émettent que des GET
vers Mimir et Loki. Aucun outil d'écriture n'existe, il ne peut donc rien modifier dans le cluster."""
from __future__ import annotations

import json
import re
import time

from langchain.agents import create_agent
from langchain_core.tools import tool

from . import clients, config
from .clients import UpstreamError
from .units import annotate_series

_MAX_TOOL_CHARS = 3500   # résultat d'outil renvoyé au modèle : ~3000 tokens lus = 35-44 s mesurés (16.10.2026)


def _out(fn, *a, **kw) -> str:
    """Résultat d'outil en texte ; les erreurs sont renvoyées au modèle (il peut corriger sa requête)."""
    try:
        s = json.dumps(fn(*a, **kw), ensure_ascii=False)
    except UpstreamError as e:
        return f"ERREUR: {e}"
    return s if len(s) <= _MAX_TOOL_CHARS else s[:_MAX_TOOL_CHARS] + " ...[tronqué]"


def _with_units(fn, query: str, *args) -> dict:
    """Appelle Mimir puis ajoute le champ `lisible` (octets) calculé en Python : le modèle se trompait en
    convertissant lui-même les octets (facteur 10, test du 16.10.2026)."""
    data = fn(query, *args)
    annotate_series(data.get("data", {}).get("result", []), query)
    return data


@tool
def promql_instant(query: str) -> str:
    """Exécute une requête PromQL instantanée sur Mimir (métriques). Ex: count(up)."""
    return _out(_with_units, clients.metrics_instant, query)


@tool
def promql_range(query: str, minutes: int = 60, step_s: int = 60) -> str:
    """Exécute une requête PromQL sur les `minutes` dernières minutes (pas `step_s` secondes)."""
    return _out(_with_units, clients.metrics_range, query, minutes, step_s)


@tool
def metric_label_values(label: str) -> str:
    """Liste les valeurs d'un label de métriques (ex: namespace, pod, cluster)."""
    return _out(clients.metrics_label_values, label)


_LOG_LINE_CHARS = 250   # une ligne de log Mimir dépasse souvent 1000 caractères (« query stats »)
_LOG_KEEP_LABELS = ("namespace", "pod", "container", "detected_level")


def compact_logs(data: dict) -> str:
    """Forme compacte pour le modèle. Le JSON complet répète ~14 labels par ligne ; la lecture du prompt
    coûte du temps sur CPU (~47 tok/s mesuré), donc on ne garde que l'utile et on tronque les lignes."""
    streams = data.get("data", {}).get("result", [])
    rows = []
    for st in streams:
        lab = st.get("stream", {})
        who = "/".join(str(lab.get(k, "?")) for k in _LOG_KEEP_LABELS[:3])
        lvl = lab.get("detected_level", "?")
        for ts, line in st.get("values", []):
            rows.append((ts, f"[{lvl}] {who} {line[:_LOG_LINE_CHARS]}" + (" …" if len(line) > _LOG_LINE_CHARS else "")))
    rows.sort(reverse=True)
    return f"{len(rows)} ligne(s) :\n" + "\n".join(r[1] for r in rows)


_K8S_NAME = re.compile(r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$")


def build_logql(namespace: str, pod_prefix: str = "", contains: str = "") -> str:
    """Construit le sélecteur LogQL à partir de paramètres : le modèle ne l'écrit plus lui-même. Constat du
    16.10.2026 : en écriture libre il cherchait dans tous les namespaces (`{namespace!=""}`) malgré une question
    sur Mimir. Ici le namespace est obligatoire et validé."""
    if not _K8S_NAME.match(namespace or ""):
        raise ValueError(f"namespace invalide : {namespace!r}")
    sel = f'namespace="{namespace}"'
    if pod_prefix:
        if not _K8S_NAME.match(pod_prefix):
            raise ValueError(f"préfixe de pod invalide : {pod_prefix!r}")
        sel += f', pod=~"{pod_prefix.replace(".", "[.]")}.*"'
    q = "{" + sel + "}"
    if contains:
        text = contains.replace("`", "")   # chaîne brute entre accents graves : pas d'échappement à gérer
        q += f" |~ `(?i){re.escape(text)}`"   # insensible à la casse, texte littéral (pas une regex libre)
    return q


@tool
def search_logs(namespace: str, contains: str = "", pod_prefix: str = "", minutes: int = 15, limit: int = 15) -> str:
    """Cherche des logs dans UN namespace (obligatoire, ex: mimir, loki, garage) sur les `minutes` dernières
    minutes. `contains` : texte à trouver, sans tenir compte de la casse (ex: error, status=failed, 404).
    `pod_prefix` : début du nom de pod (ex: mimir-compactor). Renvoie les lignes les plus récentes, tronquées."""
    try:
        q = build_logql(namespace, pod_prefix, contains)
        text = f"requête LogQL : {q}\n" + compact_logs(clients.logs_range(q, minutes, limit))
    except (ValueError, UpstreamError) as e:
        return f"ERREUR: {e}"
    return text if len(text) <= _MAX_TOOL_CHARS else text[:_MAX_TOOL_CHARS] + " ...[tronqué]"


@tool
def find_problems_in_namespace(namespace: str, minutes: int = 30, pod_prefix: str = "") -> str:
    """Recense les problèmes (requêtes en échec, erreurs, avertissements) dans les logs d'UN namespace sur les
    `minutes` dernières minutes. La classification est faite par le service, pas par toi : rapporte les nombres
    et exemples tels quels. Utilise cet outil pour toute question « y a-t-il des erreurs / des échecs ? »."""
    from .problems import find_problems
    try:
        return json.dumps(find_problems(namespace, minutes, pod_prefix), ensure_ascii=False)[:_MAX_TOOL_CHARS]
    except (ValueError, UpstreamError) as e:
        return f"ERREUR: {e}"


@tool
def log_label_values(label: str) -> str:
    """Liste les valeurs d'un label de logs Loki (ex: namespace, pod, level)."""
    return _out(clients.logs_label_values, label)


TOOLS = [promql_instant, promql_range, metric_label_values, find_problems_in_namespace, search_logs, log_label_values]

_ctx_cache: tuple[float, str] | None = None


def cluster_context(ttl_s: int = 300) -> str:
    """Labels réels du cluster, relevés dans Mimir/Loki (mis en cache). Sans ce contexte, le modèle a inventé
    un label `cluster=~"cluster-.*"` lors du test du 15.10.2026 (la valeur réelle est `kind-local`)."""
    global _ctx_cache
    if _ctx_cache and time.time() - _ctx_cache[0] < ttl_s:
        return _ctx_cache[1]
    parts = []
    for title, fn, label in (
        ("Valeurs du label métrique `cluster`", clients.metrics_label_values, "cluster"),
        ("Valeurs du label métrique `namespace`", clients.metrics_label_values, "namespace"),
        ("Labels de logs disponibles", None, None),
        ("Valeurs du label de logs `namespace`", clients.logs_label_values, "namespace"),
    ):
        try:
            data = (clients.logs_labels() if fn is None else fn(label)).get("data", [])
            parts.append(f"- {title} : {', '.join(map(str, data))}")
        except UpstreamError as e:
            parts.append(f"- {title} : indisponible ({e})")
    text = "\n".join(parts)
    _ctx_cache = (time.time(), text)
    return text


SYSTEM_PROMPT = """Tu es un assistant d'exploitation Kubernetes en LECTURE SEULE. Tu réponds en français.
Tu disposes d'outils qui interrogent Mimir (métriques, PromQL) et Loki (logs, LogQL). Tu ne peux rien modifier.
Périmètre : tu ne traites QUE la supervision de ce cluster Kubernetes (métriques, logs, pods, ressources). Pour toute
autre question (météo, culture générale, programmation, actualité, etc.), réponds en une phrase que tu es limité à la
supervision du cluster, sans appeler d'outil. Tu peux répondre à une salutation et dire ce que tu sais faire.
Règles :
- Appuie chaque affirmation sur le résultat d'un outil. N'invente jamais de valeur, de métrique ou de label.
- Le contexte ci-dessous donne les labels et les valeurs de `cluster` et `namespace`. N'appelle metric_label_values ou
  log_label_values que si ta requête a besoin d'un nom absent du contexte (par ex. un pod précis). Pour un classement
  (topk), un comptage ou une agrégation par pod ou namespace, n'appelle PAS ces outils : aucun nom n'est nécessaire.
- Si un outil renvoie une ERREUR, corrige ta requête ou dis clairement que tu n'as pas pu répondre.
- Si les résultats ne permettent pas de conclure, dis-le. Cite les requêtes utilisées.
- Pour un classement (« les N plus … »), utilise promql_instant avec topk(N, <agrégation>) : la forme est
  topk(3, sum by (pod) (...)), sans `by` après topk. Pour la mémoire d'un pod, préfère
  container_memory_working_set_bytes avec le filtre container!="" (évite les doublons de conteneurs pause).
- « Y a-t-il des erreurs / des échecs / des problèmes dans <composant> ? » : appelle find_problems_in_namespace avec
  le namespace du composant. Le résultat est une classification faite par le service : rapporte ses nombres de LIGNES
  de log (pas de requêtes distinctes : un même échec peut être journalisé par plusieurs composants, ex. gateway et
  query-frontend) et ses exemples, n'écris « aucun problème » que si toutes les catégories sont absentes, et signale si plafond_atteint
  est vrai. Une ligne `level=info` avec `status=failed` ou un code 4xx/5xx EST une requête en échec.
- Pour lire des logs précis, search_logs dans SON namespace uniquement ; ne cite que des lignes du namespace demandé.
- Réponds en 120 mots maximum, sans recopier de longues lignes de logs.
- Une valeur de métrique n'est pas une durée ni un maximum : n'ajoute pas d'interprétation que la requête ne mesure pas.
- Valeurs en octets : recopie le champ `lisible` (ou `lisible_max` / `lisible_derniere`) tel quel, avec son unité
  (MiB, GiB). Ne convertis JAMAIS toi-même : tes conversions de tête sont fausses. Sans champ `lisible`, donne la
  valeur brute sans dire qu'elle est en octets.

Contexte réel du cluster :
{context}
"""


def build_llm():
    """Modèle de langage selon LLM_PROVIDER. Imports tardifs : seule la bibliothèque du fournisseur choisi est chargée."""
    if config.LLM_PROVIDER == "bedrock":
        from langchain_aws import ChatBedrockConverse
        return ChatBedrockConverse(model=config.BEDROCK_MODEL_ID, region_name=config.BEDROCK_REGION,
                                   temperature=0, max_tokens=config.LLM_MAX_TOKENS)
    if config.LLM_PROVIDER == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=config.LLM_MODEL,
            base_url=config.OLLAMA_URL,
            reasoning=config.LLM_REASONING,
            num_ctx=config.LLM_NUM_CTX,
            temperature=0,
        )
    raise ValueError(f"LLM_PROVIDER inconnu : {config.LLM_PROVIDER!r} (attendu : ollama ou bedrock)")


def build_agent():
    return create_agent(build_llm(), TOOLS, system_prompt=SYSTEM_PROMPT.format(context=cluster_context()))


def llm_stats(msgs) -> list[dict]:
    """Une entrée par appel au modèle. Ollama : durées détaillées (secondes), pour mesurer où passe le temps.
    Bedrock : tokens et latence de l'appel seulement (Bedrock ne détaille ni chargement ni lecture du prompt) ;
    `total_s` reste un nombre, car scripts/bench_ask.py les additionne."""
    out = []
    for m in msgs:
        md = getattr(m, "response_metadata", None) or {}
        um = getattr(m, "usage_metadata", None) or {}
        if "total_duration" in md:
            sec = lambda k: round((md.get(k) or 0) / 1e9, 1)
            out.append({"total_s": sec("total_duration"), "load_s": sec("load_duration"),
                        "prompt_tokens": md.get("prompt_eval_count"), "prompt_s": sec("prompt_eval_duration"),
                        "output_tokens": md.get("eval_count"), "gen_s": sec("eval_duration")})
        elif um:
            lat = (md.get("metrics") or {}).get("latencyMs") or 0
            lat = sum(lat) if isinstance(lat, list) else lat   # la bibliothèque le renvoie parfois sous forme de liste
            out.append({"total_s": round(lat / 1000, 1), "prompt_tokens": um.get("input_tokens"),
                        "output_tokens": um.get("output_tokens")})
    return out


def text_of(content) -> str:
    """Texte d'un message : chaîne (Ollama) ou liste de blocs (Bedrock : [{"type": "text", "text": ...}])."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b if isinstance(b, str) else b.get("text", "") for b in content
                       if isinstance(b, str) or (isinstance(b, dict) and b.get("type", "text") == "text"))
    return "" if content is None else str(content)


def tool_trace(msgs) -> list[dict]:
    """Un élément par appel d'outil : nom, arguments et début du résultat que l'agent a reçu (`result`, tronqué à
    TRACE_RESULT_CHARS). Permet de comparer la réponse à ce que l'outil a réellement renvoyé."""
    results = {getattr(m, "tool_call_id", None): m.content for m in msgs if getattr(m, "type", "") == "tool"}
    out = []
    for m in msgs:
        for c in (getattr(m, "tool_calls", None) or []):
            item = {"tool": c["name"], "args": c["args"]}
            n = config.TRACE_RESULT_CHARS
            if n > 0 and c.get("id") in results:
                text = str(results[c["id"]])
                item["result"] = text if len(text) <= n else text[:n] + " ...[tronqué]"
            out.append(item)
    return out


def chat(turns: list[tuple[str, str]], agent=None) -> dict:
    """Répond à une conversation [(« user » | « assistant », texte), ...] dont le dernier tour est celui de l'utilisateur."""
    agent = agent or build_agent()
    res = agent.invoke({"messages": turns}, config={"recursion_limit": 2 * config.AGENT_MAX_STEPS + 1})
    msgs = res["messages"]
    return {"answer": text_of(msgs[-1].content), "tool_calls": tool_trace(msgs), "llm_calls": llm_stats(msgs)}


def ask(question: str, agent=None) -> dict:
    return chat([("user", question)], agent=agent)
