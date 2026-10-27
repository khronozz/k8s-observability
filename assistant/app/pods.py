"""Vue d'ensemble déterministe d'UN pod : état, redémarrages, raison d'arrêt, dernières lignes de logs.

Pourquoi en code : au test du 27.10.2026 (F2), le modèle avait trouvé le pod dans les métriques (namespace `test-incident`)
mais a cherché ses logs dans `default`, un namespace deviné, et n'a donc jamais lu l'erreur de connexion. Ici le namespace
vient des métriques du pod lui-même, sans passer par le modèle. Le modèle ne fait que reformuler le résultat.
"""
from __future__ import annotations

import re

from . import clients
from .clients import UpstreamError

_MAX_PODS = 5
_LOG_LINES = 8
_LOG_CHARS = 1200
_NAME = re.compile(r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$")


def _vec(query: str) -> list[dict]:
    return clients.metrics_instant(query).get("data", {}).get("result", [])


def _key(r: dict) -> tuple[str, str]:
    m = r.get("metric", {})
    return m.get("namespace", "?"), m.get("pod", "?")


def _num(r: dict) -> float | None:
    try:
        return float(r["value"][1])
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def describe_pod(pod_prefix: str, minutes: int = 30) -> dict:
    from .agent import build_logql, compact_logs, exclude_own_queries   # mêmes règles de validation que search_logs
    if not _NAME.match(pod_prefix or ""):
        raise ValueError(f"nom de pod invalide : {pod_prefix!r}")
    sel = f'pod=~"{pod_prefix.replace(".", "[.]")}.*"'
    phases = _vec(f"kube_pod_status_phase{{{sel}}} == 1")
    pods: dict[tuple[str, str], dict] = {}
    for r in phases:
        pods.setdefault(_key(r), {"namespace": _key(r)[0], "pod": _key(r)[1], "phase": r["metric"].get("phase")})
    if not pods:
        return {"trouve": False, "pod_prefix": pod_prefix,
                "note": "Aucune série kube_pod_status_phase pour ce préfixe : le pod n'existe pas (ou a disparu depuis "
                        "quelques minutes), ou kube-state-metrics ne le voit pas."}
    keys = sorted(pods)[:_MAX_PODS]
    for r in _vec(f'kube_pod_status_ready{{{sel}, condition="true"}}'):
        if _key(r) in pods:
            pods[_key(r)]["pret"] = _num(r) == 1.0
    for r in _vec(f"sum by (namespace, pod) (kube_pod_container_status_restarts_total{{{sel}}})"):
        if _key(r) in pods:
            pods[_key(r)]["redemarrages_total"] = int(_num(r) or 0)
    for r in _vec(f"sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total{{{sel}}}[10m]))"):
        if _key(r) in pods:
            pods[_key(r)]["redemarrages_10_dernieres_min"] = round(_num(r) or 0)
    for r in _vec(f"kube_pod_container_status_last_terminated_reason{{{sel}}} == 1"):
        if _key(r) in pods:
            pods[_key(r)]["derniere_terminaison"] = r["metric"].get("reason")
    for r in _vec(f"max_over_time(kube_pod_container_status_waiting_reason{{{sel}}}[10m]) == 1"):
        if _key(r) in pods:
            seen = pods[_key(r)].setdefault("attente_10_dernieres_min", [])
            if r["metric"].get("reason") not in seen:
                seen.append(r["metric"].get("reason"))
    out = []
    for k in keys:
        p = pods[k]
        try:   # les logs sont cherchés dans le namespace de CE pod
            q = exclude_own_queries(build_logql(p["namespace"], p["pod"]))
            text = compact_logs(clients.logs_range(q, minutes, _LOG_LINES))
            p["logs_recents"] = text if len(text) <= _LOG_CHARS else text[:_LOG_CHARS] + " ...[tronqué]"
        except (ValueError, UpstreamError) as e:
            p["logs_recents"] = f"indisponible : {e}"
        out.append(p)
    return {"trouve": True, "pods": out, "nb_pods_trouves": len(pods),
            "avertissement": "phase=Running ne veut pas dire sain : voir `pret`, les redémarrages, l'attente et les logs."}
