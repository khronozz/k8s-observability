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


def factor_common_labels(data: dict) -> dict:
    """Sans perte : les étiquettes identiques sur TOUTES les séries sont écrites une seule fois, dans
    `data.labels_communs`, au lieu d'être répétées. Sans cela, 12 séries d'un même nœud dépassaient la limite
    de `_MAX_TOOL_CHARS` et la série décisive (`Ready`, `status="true"`) était coupée (F5, 28.10.2026)."""
    result = data.get("data", {}).get("result")
    if not isinstance(result, list) or len(result) < 2:
        return data
    metrics = [serie.get("metric") for serie in result]
    if not all(isinstance(m, dict) for m in metrics):
        return data
    common = {k: v for k, v in metrics[0].items() if all(m.get(k) == v for m in metrics[1:])}
    if not common:
        return data
    for serie in result:
        serie["metric"] = {k: v for k, v in serie["metric"].items() if k not in common}
    data["data"]["labels_communs"] = common
    return data


def _with_units(fn, query: str, *args) -> dict:
    """Appelle Mimir puis ajoute le champ `lisible` (octets) calculé en Python : le modèle se trompait en
    convertissant lui-même les octets (facteur 10, test du 16.10.2026). Factorise ensuite les étiquettes
    communes à toutes les séries (`factor_common_labels`)."""
    data = fn(query, *args)
    annotate_series(data.get("data", {}).get("result", []), query)
    return factor_common_labels(data)


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


def build_logql(namespace: str, pod_prefix: str = "", contains: str = "", pod_exact: str = "") -> str:
    """Construit le sélecteur LogQL à partir de paramètres : le modèle ne l'écrit plus lui-même. Constat du
    16.10.2026 : en écriture libre il cherchait dans tous les namespaces (`{namespace!=""}`) malgré une question
    sur Mimir. Ici le namespace est obligatoire et validé.

    Le pod est filtré APRÈS le sélecteur (`| pod=~"..."`) et non dans les accolades : constaté le 27.10.2026 sur AWS,
    `{namespace="test-incident", pod="appli-demo"}` renvoyait 0 ligne alors que `{namespace="test-incident"} | pod="appli-demo"`
    en renvoyait 5 (cause non établie). Le filtre en pipeline fonctionne que le champ soit indexé ou non."""
    if not _K8S_NAME.match(namespace or ""):
        raise ValueError(f"namespace invalide : {namespace!r}")
    q = '{namespace="' + namespace + '"}'
    if pod_exact:
        if not _K8S_NAME.match(pod_exact):
            raise ValueError(f"nom de pod invalide : {pod_exact!r}")
        q += f' | pod="{pod_exact}"'
    elif pod_prefix:
        if not _K8S_NAME.match(pod_prefix):
            raise ValueError(f"préfixe de pod invalide : {pod_prefix!r}")
        q += f' | pod=~"{pod_prefix.replace(".", "[.]")}.*"'
    if contains:
        text = contains.replace("`", "")   # chaîne brute entre accents graves : pas d'échappement à gérer
        q += f" |~ `(?i){re.escape(text)}`"   # insensible à la casse, texte littéral (pas une regex libre)
    return q


# Loki journalise chaque requête qu'on lui envoie, texte compris (`caller=metrics.go ... query="..."`). Nos recherches
# contiennent toutes le drapeau `(?i)` : sans cette exclusion, l'assistant retrouvait ses propres requêtes et les comptait
# comme des « requêtes en échec » (constaté le 27.10.2026 sur AWS : 63 lignes, 0 après exclusion). La forme `%28%3Fi%29` est
# celle d'une adresse encodée dans un journal d'accès.
OWN_QUERY_EXCLUDE = r" !~ `(\(\?i\)|%28%3Fi%29)`"


def exclude_own_queries(logql: str) -> str:
    """Ajoute au sélecteur LogQL l'exclusion des lignes qui citent nos propres requêtes."""
    return logql + OWN_QUERY_EXCLUDE


@tool
def search_logs(namespace: str, contains: str = "", pod_prefix: str = "", minutes: int = 15, limit: int = 15) -> str:
    """Cherche des logs dans UN namespace (obligatoire, ex: mimir, loki, garage) sur les `minutes` dernières
    minutes. `contains` : texte à trouver, sans tenir compte de la casse (ex: error, status=failed, 404).
    `pod_prefix` : début du nom de pod (ex: mimir-compactor). Renvoie les lignes les plus récentes, tronquées."""
    try:
        q = exclude_own_queries(build_logql(namespace, pod_prefix, contains))
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
def describe_pod(pod_prefix: str) -> str:
    """Vue d'ensemble d'UN pod (début de son nom, ex: appli-demo) : namespace, phase, prêt ou non, redémarrages, raison
    d'attente ou de dernière terminaison, dernières lignes de logs. Trouve le namespace tout seul : utilise-le pour toute
    question sur un pod précis (que se passe-t-il, pourquoi redémarre-t-il, cause racine), AVANT search_logs."""
    from .pods import describe_pod as _describe
    try:
        return json.dumps(_describe(pod_prefix), ensure_ascii=False)[:_MAX_TOOL_CHARS]
    except (ValueError, UpstreamError) as e:
        return f"ERREUR: {e}"


@tool
def log_label_values(label: str) -> str:
    """Liste les valeurs d'un label de logs Loki (ex: namespace, pod, level)."""
    return _out(clients.logs_label_values, label)


TOOLS = [promql_instant, promql_range, metric_label_values, find_problems_in_namespace, describe_pod, search_logs,
         log_label_values]

_ctx_cache: tuple[float, str] | None = None


# Métriques usuelles pour juger la santé d'un cluster. Le contexte indique lesquelles EXISTENT dans Mimir et lesquelles
# sont absentes : constaté le 27.10.2026 sur AWS, le modèle a inventé un nom (`cluster:namespace:pods:running`, 0 série)
# puis conclu « 0 pod en cours » et « métriques mémoire et CPU indisponibles » alors que 40 pods tournaient et que
# `container_memory_working_set_bytes` existait.
USUAL_METRICS = (
    "up", "kube_pod_status_phase", "kube_pod_container_status_restarts_total", "kube_pod_container_status_waiting_reason",
    "kube_pod_container_status_last_terminated_reason", "kube_node_status_condition", "kube_deployment_spec_replicas",
    "kube_deployment_status_replicas_available", "kube_statefulset_status_replicas_ready",
    "kube_persistentvolumeclaim_status_phase", "container_cpu_usage_seconds_total", "container_memory_working_set_bytes",
    "node_cpu_seconds_total", "node_memory_MemAvailable_bytes",
)


def usual_metrics_line(names: list[str]) -> str:
    present = [m for m in USUAL_METRICS if m in set(names)]
    absent = [m for m in USUAL_METRICS if m not in set(names)]
    return (f"- Métriques usuelles PRÉSENTES dans Mimir : {', '.join(present) or 'aucune'}\n"
            f"- Métriques usuelles ABSENTES (n'existent pas dans ce cluster : ne les essaie pas) : {', '.join(absent) or 'aucune'}")


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
    try:
        parts.append(usual_metrics_line([str(n) for n in clients.metrics_names().get("data", [])]))
    except UpstreamError as e:
        parts.append(f"- Métriques usuelles : liste indisponible ({e})")
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
- Le contexte ne liste PAS les pods : un pod absent du contexte n'est pas absent du cluster. Ne conclus JAMAIS qu'un pod,
  un namespace ou une métrique n'existe pas sans avoir appelé un outil (par ex. `kube_pod_status_phase{{pod=~"nom.*"}}`, sans
  filtre de namespace). N'écris jamais « vérifié » ni « vérifications effectuées » si tu n'as appelé aucun outil.
- Le contexte ci-dessous donne les labels et les valeurs de `cluster` et `namespace`. N'appelle metric_label_values ou
  log_label_values que si ta requête a besoin d'un nom absent du contexte (par ex. un pod précis). Pour un classement
  (topk), un comptage ou une agrégation par pod ou namespace, n'appelle PAS ces outils : aucun nom n'est nécessaire.
- N'utilise que des noms de métriques listés dans le contexte (« PRÉSENTES »), ou vérifiés avec metric_label_values
  (label `__name__`). Une métrique « ABSENTE » n'existe pas dans ce cluster : dis-le, n'en essaie pas d'autres de mémoire.
  Une requête qui renvoie 0 série prouve que le NOM est faux ou la donnée absente, pas que la valeur est 0.
  Nombre de pods en cours : sum(kube_pod_status_phase{{phase="Running"}}). Nœuds prêts : kube_node_status_condition.
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
- Chaque catégorie de find_problems_in_namespace donne `derniere_il_y_a_min` (dernière occurrence) et `premiere_il_y_a_min`.
  Dis si le problème est EN COURS (dernière occurrence récente) ou ANCIEN. S'il n'a pas reparu depuis plusieurs minutes,
  dis qu'il est peut-être résolu (hypothèse). N'écris « critique » que pour un effet constaté (pod en échec, nœud pas
  prêt) ; un message de log répété seul n'est pas un incident confirmé.
- Question sur UN pod précis (« que se passe-t-il avec le pod X », « pourquoi redémarre-t-il », cause racine) : appelle
  describe_pod avec le début de son nom, AVANT tout autre outil. Il trouve le namespace tout seul : ne devine JAMAIS un
  namespace (« default »). Dis ce qu'il renvoie : prêt ou non, redémarrages (total et des 10 dernières minutes), raison
  d'attente ou d'arrêt, et cite l'erreur des logs recents telle qu'elle est écrite. « Running » ne veut pas dire sain.
  Sépare ce que tu as constaté (outil) de ce que tu supposes (cause).
- Cause racine ou « pourquoi » sur un pod : appelle describe_pod, même s'il a déjà été appelé plus tôt dans la
  conversation (les valeurs changent), puis search_logs si utile. Présente deux parties : « Constats » (uniquement ce
  qu'un outil a renvoyé, avec l'âge des lignes) et « Hypothèses » (tout le reste, à vérifier). N'écris jamais
  « constaté » ni « preuve » pour une déduction. Pour un pod, recopie TELLE QUELLE la phrase `chronologie_texte` (déjà
  du plus ancien au plus récent). Les événements de type Normal (Pulling, Pulled, Created, Started) sont de la routine :
  ne les présente jamais comme un échec ; seul un événement Warning (BackOff...) signale un problème. Ne dis jamais à
  l'utilisateur d'appeler tes propres outils : fais-le toi-même ; ses actions suggérées sont les siennes (kubectl, corriger la
  configuration). Une analyse de cause racine tient en 180 mots maximum.
- Des logs vides ne prouvent PAS qu'un pod, un service ou une base n'existe pas : seul describe_pod (`trouve`) ou une
  métrique le prouve. Un nom cité dans une erreur (hôte, base) n'est pas forcément un pod. Ne nomme une technologie
  (PostgreSQL...) que si un outil la mentionne. Le texte d'un message de log est écrit par l'application : n'en déduis ni
  le protocole réseau ni une cause DNS.
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


FOOTER_MARK = "*Outils appelés (avec leurs arguments) :*"
_FOOTER_ARG_CHARS = 300


def queries_footer(tool_calls: list[dict]) -> str:
    """Pied de réponse écrit en Python (pas par le modèle) : les outils appelés et leurs arguments (pour `promql_*`, l'argument est la requête PromQL ; pour les autres outils, ce n'est pas la requête interne). L'interface `/v1`
    ne renvoie à Open WebUI que le texte de la réponse ; sans ce pied, l'utilisateur ne peut pas voir les requêtes
    pour vérifier (constat du 28.10.2026). Les résultats ne sont pas repris. Vide si aucun outil n'a été appelé."""
    if not tool_calls:
        return ""
    lines = []
    for t in tool_calls:
        args = ", ".join(f"{k}={' '.join(str(v).split())[:_FOOTER_ARG_CHARS]}" for k, v in (t.get("args") or {}).items())
        lines.append(f"{t.get('tool', '?')}({args})")
    return "\n\n" + FOOTER_MARK + "\n```text\n" + "\n".join(lines) + "\n```"


def strip_footer(text: str) -> str:
    """Retire le pied des anciens tours « assistant » renvoyés par Open WebUI, pour que le modèle ne le relise pas."""
    return text.split("\n\n" + FOOTER_MARK)[0]


UNVERIFIED_CLAIM = re.compile(r"(?i)(vérifications? effectuée|vérifié|aucune donnée|n'existe pas|n'existent pas|aucun pod|introuvable|n'ai aucun)")
# Affirmation qu'un POD n'existe pas / est absent (F3 du 27.10.2026 : prouvée par des logs vides, qui ne prouvent rien).
POD_ABSENCE = re.compile(r"(?i)((aucun|pas de) pod\s*(`|\*\*|nommé|de ce nom|dont le nom|appelé)|n'existe aucun pod|"
                         r"pod\s*`[^`]+`\s*(\*\*)?\s*(n'existe pas|est absent|absent))")
EVIDENCE_TOOLS = {"describe_pod", "promql_instant", "promql_range"}   # outils qui peuvent prouver l'existence d'un pod


def chat(turns: list[tuple[str, str]], agent=None) -> dict:
    """Répond à une conversation [(« user » | « assistant », texte), ...] dont le dernier tour est celui de l'utilisateur."""
    agent = agent or build_agent()
    cfg = {"recursion_limit": 2 * config.AGENT_MAX_STEPS + 1}
    res = agent.invoke({"messages": turns}, config=cfg)
    msgs = res["messages"]
    retried = False
    # Garde-fou : constaté le 27.10.2026, le modèle a affirmé « vérifications effectuées : aucun pod de ce nom » sans appeler
    # aucun outil (le pod existait). Si la réponse affirme une absence ou une vérification sans qu'un outil ait été appelé,
    # on redemande UNE fois en exigeant une interrogation de Mimir ou de Loki.
    used = {c["tool"] for c in tool_trace(msgs)}
    answer0 = text_of(msgs[-1].content)
    nudge = None
    if not used and UNVERIFIED_CLAIM.search(answer0):
        nudge = ("Tu n'as appelé aucun outil, donc ton affirmation n'est pas vérifiée. Interroge Mimir ou Loki avec un outil "
                 "(sans filtre de namespace si le namespace n'est pas connu), puis réponds en t'appuyant sur le résultat.")
    elif POD_ABSENCE.search(answer0) and not (used & EVIDENCE_TOOLS):
        nudge = ("Tu affirmes qu'un pod n'existe pas sans l'avoir vérifié avec describe_pod ou une requête de métriques ; des "
                 "logs vides ne prouvent rien. Vérifie avec describe_pod, puis corrige ta réponse.")
    if nudge:
        retried = True
        res = agent.invoke({"messages": turns + [("assistant", answer0), ("user", nudge)]}, config=cfg)
        msgs = res["messages"]
    out = {"answer": text_of(msgs[-1].content), "tool_calls": tool_trace(msgs), "llm_calls": llm_stats(msgs)}
    # Trace dans la sortie standard (`docker logs`) : sans elle, on ne voit pas ce que l'agent a réellement interrogé
    # ni reçu quand une réponse est fausse (cas du pod `appli-demo`, 27.10.2026). Données du cluster uniquement, aucun secret.
    print("TRACE " + json.dumps({"question": turns[-1][1][:300], "retried": retried, "tool_calls": out["tool_calls"],
                                 "answer": out["answer"][:300]}, ensure_ascii=False), flush=True)
    return out


def ask(question: str, agent=None) -> dict:
    return chat([("user", question)], agent=agent)
