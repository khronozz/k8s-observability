"""Accès en lecture seule à Mimir (API compatible Prometheus) et Loki.

Seules des requêtes HTTP GET sont émises. Aucune route d'écriture (push, delete, ruler) n'est appelée.
"""
from __future__ import annotations

import time
import httpx

from . import config


class UpstreamError(Exception):
    """Erreur renvoyée par Mimir/Loki ou réseau indisponible."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _get(base: str, path: str, params: dict) -> dict:
    url = base.rstrip("/") + path
    try:
        r = httpx.get(url, params=params, timeout=config.HTTP_TIMEOUT_S)
    except httpx.HTTPError as e:
        raise UpstreamError(f"{url} injoignable : {e.__class__.__name__}") from e
    if r.status_code >= 400:
        # Mimir/Loki renvoient le motif de l'erreur (ex. requête invalide) dans le corps : on le retransmet,
        # c'est ce qui permet à l'agent de corriger sa requête.
        raise UpstreamError(f"HTTP {r.status_code} : {r.text[:500]}", status=400 if r.status_code == 400 else 502)
    try:
        return r.json()
    except ValueError as e:
        raise UpstreamError("réponse non JSON") from e


def _bounds(minutes: int) -> tuple[float, float]:
    minutes = max(1, min(minutes, config.MAX_RANGE_HOURS * 60))
    end = time.time()
    return end - minutes * 60, end


# ---- Mimir ----
def metrics_instant(query: str) -> dict:
    return _get(config.MIMIR_URL, "/api/v1/query", {"query": query})


def metrics_range(query: str, minutes: int, step_s: int) -> dict:
    start, end = _bounds(minutes)
    return _get(config.MIMIR_URL, "/api/v1/query_range",
                {"query": query, "start": start, "end": end, "step": max(step_s, 1)})


def metrics_label_values(label: str) -> dict:
    return _get(config.MIMIR_URL, f"/api/v1/label/{label}/values", {})


def metrics_names() -> dict:
    return _get(config.MIMIR_URL, "/api/v1/label/__name__/values", {})


# ---- Loki ----
def logs_range(query: str, minutes: int, limit: int) -> dict:
    start, end = _bounds(minutes)
    limit = max(1, min(limit, config.MAX_LOG_LINES))
    # Loki attend des timestamps en nanosecondes (ou RFC3339) ; direction=backward = plus récents d'abord.
    return _get(config.LOKI_URL, "/loki/api/v1/query_range",
                {"query": query, "start": int(start * 1e9), "end": int(end * 1e9),
                 "limit": limit, "direction": "backward"})


def logs_label_values(label: str, minutes: int = 60) -> dict:
    start, end = _bounds(minutes)
    return _get(config.LOKI_URL, f"/loki/api/v1/label/{label}/values",
                {"start": int(start * 1e9), "end": int(end * 1e9)})


def logs_labels(minutes: int = 60) -> dict:
    start, end = _bounds(minutes)
    return _get(config.LOKI_URL, "/loki/api/v1/labels",
                {"start": int(start * 1e9), "end": int(end * 1e9)})
