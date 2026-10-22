"""Service d'assistance pour l'exploitation de Kubernetes (étape 3, partie sans IA).

Expose en LECTURE SEULE des endpoints déterministes sur Mimir (métriques) et Loki (logs). Ils serviront
d'outils à l'agent LangGraph et sont aussi utilisables seuls (test, Open WebUI via OpenAPI).
"""
from __future__ import annotations

import json
import time
import uuid

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from . import clients, config
from .clients import UpstreamError
from .units import annotate_series

app = FastAPI(
    title="Assistant d'observabilité Kubernetes",
    description="Endpoints en lecture seule sur Mimir (métriques PromQL) et Loki (logs LogQL).",
    version="0.1.0",
)


def _up(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except UpstreamError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _magnitude(serie: dict) -> float:
    """Valeur servant à ordonner une série : valeur instantanée, ou maximum des échantillons d'une plage."""
    try:
        if "value" in serie:
            return float(serie["value"][1])
        return max(float(v[1]) for v in serie.get("values", []))
    except (ValueError, IndexError, TypeError):
        return float("-inf")


def _series_summary(result: list[dict]) -> dict:
    """Limite le volume renvoyé (au modèle, la taille du contexte est la ressource rare).
    Les séries sont triées par valeur décroissante AVANT la coupure : sinon, au-delà de MAX_SERIES, une série
    très élevée pouvait être écartée au hasard (défaut constaté au test « top 3 mémoire » du 16.10.2026)."""
    ordered = sorted(result, key=_magnitude, reverse=True)
    kept = ordered[: config.MAX_SERIES]
    return {"series_total": len(result), "series_returned": len(kept), "series": kept}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/metrics/query", summary="Requête PromQL instantanée (Mimir)",
         operation_id="metrics_query")
def metrics_query(query: str = Query(..., description="Expression PromQL, ex: count(up)")):
    data = _up(clients.metrics_instant, query)
    d = data.get("data", {})
    annotate_series(d.get("result", []), query)   # champ `lisible` (octets) calculé ici, pas par le modèle
    return {"resultType": d.get("resultType"), **_series_summary(d.get("result", []))}


@app.get("/metrics/range", summary="Requête PromQL sur une période (Mimir)",
         operation_id="metrics_range")
def metrics_range(
    query: str = Query(..., description="Expression PromQL"),
    minutes: int = Query(60, ge=1, description="Fenêtre en minutes jusqu'à maintenant"),
    step_s: int = Query(60, ge=1, description="Pas en secondes"),
):
    data = _up(clients.metrics_range, query, minutes, step_s)
    d = data.get("data", {})
    annotate_series(d.get("result", []), query)
    return {"resultType": d.get("resultType"), **_series_summary(d.get("result", []))}


@app.get("/metrics/labels/{label}", summary="Valeurs d'un label de métrique (Mimir)",
         operation_id="metrics_label_values")
def metrics_label_values(label: str):
    return _up(clients.metrics_label_values, label)


@app.get("/logs/query", summary="Requête LogQL sur une période (Loki)", operation_id="logs_query")
def logs_query(
    query: str = Query(..., description='Sélecteur LogQL, ex: {namespace="mimir"} |= "error"'),
    minutes: int = Query(15, ge=1, description="Fenêtre en minutes jusqu'à maintenant"),
    limit: int = Query(50, ge=1, description=f"Nombre de lignes (plafonné à {config.MAX_LOG_LINES})"),
):
    data = _up(clients.logs_range, query, minutes, limit)
    d = data.get("data", {})
    streams = d.get("result", [])
    lines = []
    for s in streams:
        labels = s.get("stream", {})
        for ts, line in s.get("values", []):
            lines.append({"ts_ns": ts, "labels": labels, "line": line})
    lines.sort(key=lambda x: x["ts_ns"], reverse=True)
    lines = lines[: min(limit, config.MAX_LOG_LINES)]
    return {"resultType": d.get("resultType"), "lines_returned": len(lines), "lines": lines}


@app.get("/logs/problems", summary="Recense les problèmes dans les logs d'un namespace (classification déterministe)",
         operation_id="logs_problems")
def logs_problems(namespace: str = Query(..., description="Namespace Kubernetes, ex: mimir"),
                  minutes: int = Query(30, ge=1), pod_prefix: str = Query("", description="Début du nom de pod")):
    from .problems import find_problems
    try:
        return find_problems(namespace, minutes, pod_prefix)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except UpstreamError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


@app.get("/logs/labels", summary="Labels disponibles dans Loki", operation_id="logs_labels")
def logs_labels():
    return _up(clients.logs_labels)


@app.get("/logs/labels/{label}", summary="Valeurs d'un label Loki", operation_id="logs_label_values")
def logs_label_values(label: str):
    return _up(clients.logs_label_values, label)


class AskRequest(BaseModel):
    question: str


def _ask(req: "AskRequest"):
    from . import agent  # import tardif : les endpoints déterministes ne dépendent pas de LangChain
    try:
        return agent.ask(req.question)
    except Exception as e:  # modèle injoignable, limite d'étapes atteinte, etc.
        raise HTTPException(status_code=502, detail=f"{e.__class__.__name__}: {str(e)[:300]}")


app.post("/ask", summary="Poser une question en langage naturel (agent, lecture seule)", operation_id="ask")(_ask)


# ---- Interface compatible OpenAI (/v1) : Open WebUI voit l'assistant comme un MODÈLE ----
# Open WebUI envoie la conversation, l'agent répond (un seul enchaînement d'appels au LLM, au lieu d'un modèle
# intermédiaire qui appellerait ensuite l'outil). Aucune authentification, comme le reste du service : il ne doit être
# joignable que depuis l'hôte d'Open WebUI (réseau Docker local), jamais depuis Internet.
class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str
    content: str | list | None = None


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")   # température, top_p... envoyés par Open WebUI : ignorés
    model: str | None = None
    messages: list[ChatMessage]
    stream: bool = False


@app.get("/v1/models", include_in_schema=False)
def v1_models():
    return {"object": "list", "data": [{"id": config.PUBLIC_MODEL_NAME, "object": "model", "created": 0,
                                         "owned_by": "assistant"}]}


def _sse(obj) -> str:
    return "data: " + (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)) + "\n\n"


@app.post("/v1/chat/completions", include_in_schema=False)
def v1_chat_completions(req: ChatCompletionRequest):
    from . import agent  # import tardif, comme pour /ask
    # Seuls les tours « user » et « assistant » sont transmis : le prompt système est celui de l'agent, pas celui d'Open WebUI.
    turns = [(m.role, agent.text_of(m.content)) for m in req.messages if m.role in ("user", "assistant")]
    turns = [t for t in turns if t[1].strip()]
    if not turns or turns[-1][0] != "user":
        raise HTTPException(status_code=422, detail="le dernier message doit être un message « user » non vide")
    try:
        res = agent.chat(turns)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{e.__class__.__name__}: {str(e)[:300]}")
    answer, model = res["answer"], req.model or config.PUBLIC_MODEL_NAME
    cid, created = "chatcmpl-" + uuid.uuid4().hex, int(time.time())
    if req.stream:
        # Réponse « en un bloc » : l'agent n'émet pas de jetons au fil de l'eau, mais Open WebUI demande du flux (SSE).
        def events():
            base = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model}
            yield _sse({**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": answer},
                                             "finish_reason": None}]})
            yield _sse({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
            yield _sse("[DONE]")
        return StreamingResponse(events(), media_type="text/event-stream")
    pt = sum(c.get("prompt_tokens") or 0 for c in res["llm_calls"])
    ot = sum(c.get("output_tokens") or 0 for c in res["llm_calls"])
    return {"id": cid, "object": "chat.completion", "created": created, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": pt, "completion_tokens": ot, "total_tokens": pt + ot}}

# Sous-application exposant UNIQUEMENT `ask`, destinée à Open WebUI (serveur d'outils OpenAPI) : le modèle d'Open
# WebUI ne voit ainsi qu'un seul outil et n'écrit pas lui-même de PromQL/LogQL (point faible mesuré de qwen3:8b).
tools_app = FastAPI(
    title="Assistant Kubernetes (lecture seule)",
    description="Interroge Mimir (métriques) et Loki (logs) du cluster et répond en français. Lecture seule.",
    version="0.1.0",
    root_path_in_servers=False,   # sinon FastAPI insère `/tools` (relatif) avant notre URL absolue
)
tools_app.post(
    "/ask", operation_id="ask_cluster_assistant",
    summary="Poser une question sur l'état du cluster Kubernetes (métriques et logs)",
    description="Utilise cet outil pour toute question sur l'état du cluster : consommation mémoire/CPU, pods, "
                "erreurs ou échecs dans les logs d'un composant (mimir, loki, garage…). Passe la question "
                "telle que l'utilisateur l'a posée. La réponse contient aussi les requêtes exécutées.",
)(_ask)


def _tools_openapi():
    """Spécification avec UN SEUL serveur, absolu (FastAPI ajouterait sinon `/tools` en premier, relatif)."""
    if tools_app.openapi_schema is None:
        from fastapi.openapi.utils import get_openapi
        schema = get_openapi(title=tools_app.title, version=tools_app.version,
                             description=tools_app.description, routes=tools_app.routes)
        schema["servers"] = [{"url": config.TOOLS_PUBLIC_URL}]
        tools_app.openapi_schema = schema
    return tools_app.openapi_schema


tools_app.openapi = _tools_openapi
app.mount("/tools", tools_app)
