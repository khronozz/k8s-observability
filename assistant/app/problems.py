"""Détection déterministe des problèmes dans les logs d'un namespace.

Pourquoi en code et pas par le modèle : au test du 16.10.2026, une requête refusée par Mimir (HTTP 400, journalisée
au niveau `info` avec `status=failed`) était bien dans les résultats, et qwen3:8b a pourtant répondu « aucune
erreur ». La classification est donc faite ici ; le modèle ne fait que reformuler le résultat.

Les motifs ci-dessous sont des HEURISTIQUES établies sur les formats observés (Mimir, Loki, Garage, kube-system) ;
ils peuvent rater des formats d'autres applications. Les compteurs sont des minorants si `plafond_atteint` est vrai.
"""
from __future__ import annotations

import re
import time

from . import clients, config

# Filtre envoyé à Loki (large : le tri fin se fait ensuite en Python). Chaîne brute entre accents graves.
LOKI_FILTER = (r'(?i)(status=failed|status_code=[45][0-9][0-9]|\]\s+[45][0-9][0-9]\s+"'
               r'|level=(error|err|fatal|crit|warn)|"level":"(error|fatal|warn)|error|panic|fatal)')

# (catégorie, motif) dans l'ordre de priorité : une ligne est rangée dans la première catégorie qui correspond.
CATEGORIES: list[tuple[str, re.Pattern]] = [
    ("requete_en_echec", re.compile(r'status=failed|status_code=[45]\d\d|\]\s+[45]\d\d\s+"')),
    ("niveau_error_fatal", re.compile(r'level=(error|err|fatal|crit)\b|"level":"(error|fatal)"|\bpanic\b|\bfatal\b', re.I)),
    ("avertissement", re.compile(r'level=warn(ing)?\b|"level":"warn', re.I)),
    ("mot_error", re.compile(r'error', re.I)),
]
# Compteurs « zéro erreur » (ex. partial_errors=0) : ne sont pas des erreurs.
_ZERO_COUNTER = re.compile(r'[A-Za-z_]*errors?=0\b')
_EXAMPLES = 3
_LINE_CHARS = 250


def classify(line: str) -> str | None:
    cleaned = _ZERO_COUNTER.sub("", line)
    for name, pat in CATEGORIES:
        if pat.search(cleaned):
            return name
    return None


def _age_min(ts_ns: str, now: float) -> int | None:
    """Ancienneté en minutes d'une ligne de log (horodatage Loki en nanosecondes) ; None si illisible."""
    try:
        return max(0, int((now - int(ts_ns) / 1e9) // 60))
    except (TypeError, ValueError):
        return None


def find_problems(namespace: str, minutes: int = 30, pod_prefix: str = "") -> dict:
    from .agent import build_logql, exclude_own_queries   # validation du namespace / préfixe (mêmes règles que search_logs)
    # On exclut les lignes de Loki qui citent notre propre requête (elle contient « status=failed », « error »...).
    q = exclude_own_queries(build_logql(namespace, pod_prefix)) + f" |~ `{LOKI_FILTER}`"
    data = clients.logs_range(q, minutes, config.MAX_LOG_LINES)
    rows = []
    for st in data.get("data", {}).get("result", []):
        who = st.get("stream", {}).get("pod", "?")
        for ts, line in st.get("values", []):
            rows.append((ts, who, line))
    rows.sort(reverse=True)
    now = time.time()
    cats: dict[str, dict] = {}
    for ts, who, line in rows:
        c = classify(line)
        if c is None:
            continue
        age = _age_min(ts, now)
        # Les lignes sont triées de la plus récente à la plus ancienne : la première rencontrée est la dernière
        # occurrence, la dernière rencontrée la première. Sert à dire si un problème est en cours ou déjà passé.
        slot = cats.setdefault(c, {"lignes": 0, "derniere_il_y_a_min": age, "exemples": []})
        slot["premiere_il_y_a_min"] = age
        slot["lignes"] += 1
        if len(slot["exemples"]) < _EXAMPLES:
            slot["exemples"].append(f"{who}: {line[:_LINE_CHARS]}" + (" …" if len(line) > _LINE_CHARS else ""))
    return {"namespace": namespace, "fenetre_minutes": minutes, "lignes_examinees": len(rows),
            "plafond_atteint": len(rows) >= config.MAX_LOG_LINES, "categories": cats,
            "motifs": [n for n, _ in CATEGORIES]}
