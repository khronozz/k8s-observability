"""Vue d'ensemble déterministe d'UN pod : état, redémarrages, raison d'arrêt, dernières lignes de logs.

Pourquoi en code : au test du 27.10.2026 (F2), le modèle avait trouvé le pod dans les métriques (namespace `test-incident`)
mais a cherché ses logs dans `default`, un namespace deviné, et n'a donc jamais lu l'erreur de connexion. Ici le namespace
vient des métriques du pod lui-même, sans passer par le modèle. Le modèle ne fait que reformuler le résultat.
"""
from __future__ import annotations

import re
import time

from . import clients
from .clients import UpstreamError
from .problems import _age_min

_MAX_PODS = 5
_LOG_LINES = 8
_LOG_CHARS = 1200
_NAME = re.compile(r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$")
_WIDE_MIN = 360          # si rien sur la fenêtre normale : on élargit (un conteneur qui plante peut ne laisser que de rares lignes)
_EVENTS_MIN = 120
_EVENTS_MAX = 5
# Événements Kubernetes collectés par Alloy (job `eventhandler`), vus dans Loki le 27.10.2026 : label `name` (pas `pod`).
_EVENT = re.compile(r'reason=(\S+) type=(\S+)(?: count=(\d+))? msg="((?:[^"\\]|\\.)*)"')


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
        _add_logs(p, minutes)
        _add_events(p)
        out.append(p)
    return {"trouve": True, "pods": out, "nb_pods_trouves": len(pods),
            "avertissement": "phase=Running ne veut pas dire sain : voir `pret`, les redémarrages, l'attente et les logs."}


def _newest(data: dict) -> str | None:
    stamps = [v[0] for st in data.get("data", {}).get("result", []) for v in st.get("values", [])]
    return max(stamps, key=int) if stamps else None


def _add_logs(p: dict, minutes: int) -> None:
    """Logs du conteneur, cherchés dans le namespace de CE pod ; fenêtre élargie à 6 h si rien n'est trouvé."""
    from .agent import build_logql, compact_logs, exclude_own_queries
    try:
        q = exclude_own_queries(build_logql(p["namespace"], pod_exact=p["pod"]))
        used, data = minutes, clients.logs_range(q, minutes, _LOG_LINES)
        newest = _newest(data)
        if newest is None and minutes < _WIDE_MIN:
            used, data = _WIDE_MIN, clients.logs_range(q, _WIDE_MIN, _LOG_LINES)
            newest = _newest(data)
    except (ValueError, UpstreamError) as e:
        p["logs_recents"] = f"indisponible : {e}"
        return
    p["logs_fenetre_minutes"] = used
    if newest is None:
        p["logs_recents"] = "aucune ligne"
        p["logs_note"] = (f"Aucune ligne de log trouvée dans Loki sur {used} min pour ce pod. Un conteneur qui vit très peu "
                          "de temps peut ne pas être collecté (cause possible, non vérifiée).")
        return
    text = compact_logs(data)
    p["logs_recents"] = text if len(text) <= _LOG_CHARS else text[:_LOG_CHARS] + " ...[tronqué]"
    p["derniere_ligne_de_log_il_y_a_min"] = _age_min(newest, time.time())


def _add_events(p: dict) -> None:
    """Événements Kubernetes du pod (BackOff, Pulling, Killing...), du plus récent au plus ancien, un par raison."""
    if not _NAME.match(p["namespace"]) or not _NAME.match(p["pod"]):
        return
    # Filtres en pipeline (`| name=...`) : `name` n'est pas dans la liste des labels indexés de Loki (relevé du 27.10.2026).
    q = f'{{namespace="{p["namespace"]}"}} | job="integrations/kubernetes/eventhandler" | name="{p["pod"]}"'
    try:
        data = clients.logs_range(q, _EVENTS_MIN, 30)
    except UpstreamError as e:
        p["evenements"] = f"indisponible : {e}"
        return
    rows = sorted(((v[0], v[1]) for st in data.get("data", {}).get("result", []) for v in st.get("values", [])), reverse=True)
    now, seen, events = time.time(), set(), []
    for ts, line in rows:
        m = _EVENT.search(line)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        events.append({"il_y_a_min": _age_min(ts, now), "type": m.group(2), "raison": m.group(1),
                       "fois": int(m.group(3)) if m.group(3) else None, "message": m.group(4)[:160]})
        if len(events) >= _EVENTS_MAX:
            break
    p["evenements"] = events
