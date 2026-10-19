"""Mise en forme DÉTERMINISTE des valeurs de métriques en octets.

Pourquoi : quand le modèle convertit lui-même « 708096000 » en Go, il se trompe (test du 16.10.2026 : open-webui
affiché « 7,11 GB » alors que la valeur réelle est 708 096 000 octets, soit 675,3 MiB ; erreur d'un facteur 10).
Une conversion de ce type est un calcul : elle est faite ici, en Python, et le modèle n'a plus qu'à recopier.

Unités BINAIRES (KiB, MiB, GiB) : ce sont celles de Kubernetes (`kubectl top` affiche des Mi/Gi), donc les valeurs
restent comparables à ce que voit l'exploitant.

Limite connue (heuristique, voir `is_bytes_query`) : Mimir ne renvoie pas l'unité d'une valeur. On la déduit du
nom de la métrique (`..._bytes`) et on s'abstient dès que la requête peut changer l'unité (rate, ratio, count…).
Dans le doute, aucun champ `lisible` n'est ajouté et la valeur brute reste seule."""
from __future__ import annotations

import math
import re

_BYTES_METRIC = re.compile(r"_bytes\b")   # `_bytes_total` (compteur) ne correspond pas : le `_` qui suit est un caractère de mot
# Opérations qui changent l'unité (octets par seconde, ratio, nombre de séries…) ou une division : pas d'étiquette.
_UNIT_CHANGING = re.compile(r"\b(rate|irate|increase|delta|idelta|deriv|count|count_values|absent|group)\s*\(|/")

_UNITS = (("B", 0), ("KiB", 1), ("MiB", 1), ("GiB", 2), ("TiB", 2))


def is_bytes_query(query: str) -> bool:
    """Vrai si la requête renvoie vraisemblablement des octets (métrique `_bytes`, sans opération qui change l'unité)."""
    return bool(_BYTES_METRIC.search(query)) and not _UNIT_CHANGING.search(query)


def format_bytes(value) -> str | None:
    """708096000 -> '675,3 MiB'. None si la valeur n'est pas un nombre fini."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n):
        return None
    sign = "-" if n < 0 else ""
    n = abs(n)
    for i, (unit, decimals) in enumerate(_UNITS):
        if n < 1024 or i == len(_UNITS) - 1:
            text = f"{n:.{decimals}f}".replace(".", ",")
            return f"{sign}{text} {unit}"
        n /= 1024
    return None   # inatteignable, pour le typage


def annotate_series(result: list[dict], query: str) -> None:
    """Ajoute le champ `lisible` (instantané) ou `lisible_max` / `lisible_derniere` (plage) à chaque série,
    uniquement si `is_bytes_query(query)`. Modifie la liste en place."""
    if not is_bytes_query(query):
        return
    for serie in result:
        if "value" in serie:
            text = format_bytes(serie["value"][1])
            if text:
                serie["lisible"] = text
        elif serie.get("values"):
            samples = [v[1] for v in serie["values"]]
            try:
                biggest = max(samples, key=float)
            except ValueError:
                continue
            for key, raw in (("lisible_max", biggest), ("lisible_derniere", samples[-1])):
                text = format_bytes(raw)
                if text:
                    serie[key] = text
