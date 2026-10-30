"""Lignes RÉELLES relevées dans les logs du cluster Kind (16.10.2026) : on vérifie la classification."""
import pytest
from app import problems as pb

FAILED_Q = ('ts=2026-10-16T13:19:20Z caller=handler.go:484 level=info user=anonymous msg="query stats" '
            'status_code=400 status=failed err="invalid parameter \\"query\\": 1:1: parse error: wrong number"')
GATEWAY_OK = '10.244.2.2 - - [16/Oct/2026:15:40:37 +0000]  200 "POST /api/v1/push HTTP/1.1" 0 "-" "Alloy/v1.20.0"'
GATEWAY_500 = '10.244.2.2 - - [16/Oct/2026:15:40:37 +0000]  502 "POST /api/v1/push HTTP/1.1" 0 "-" "Alloy/v1.20.0"'
COMPACTOR = 'ts=2026 level=info component=cleaner msg="fetched blocks metas" total_blocks=12 partial_errors=0'
GARAGE_404 = "error 404 Not Found, Key not found in response to [::ffff:10.244.2.18]:52358 HEAD /mimir-blocks/anonymous/markers/tenant-deletion-mark.json"
WARN = 'ts=2026 level=warn msg="something"'
ERR = 'ts=2026 level=error msg="boom"'


@pytest.mark.parametrize("line,expected", [
    (FAILED_Q, "requete_en_echec"), (GATEWAY_500, "requete_en_echec"), (GATEWAY_OK, None),
    (COMPACTOR, None), (GARAGE_404, "mot_error"), (WARN, "avertissement"), (ERR, "niveau_error_fatal"),
])
def test_classify(line, expected):
    assert pb.classify(line) == expected


def test_find_problems_counts_and_cap(monkeypatch):
    lines = [FAILED_Q, COMPACTOR, GARAGE_404, GATEWAY_OK]
    monkeypatch.setattr(pb.clients, "logs_range", lambda q, m, l: {"data": {"result": [
        {"stream": {"pod": "p1"}, "values": [[str(10 - i), x] for i, x in enumerate(lines)]}]}})
    r = pb.find_problems("mimir", 30)
    assert r["lignes_examinees"] == 4 and r["plafond_atteint"] is False
    assert r["categories"]["requete_en_echec"]["lignes"] == 1
    assert r["categories"]["mot_error"]["lignes"] == 1 and "avertissement" not in r["categories"]


def test_find_problems_rejects_bad_namespace():
    with pytest.raises(ValueError):
        pb.find_problems('x"} or {a="b')


def test_find_problems_reports_age_of_first_and_last_occurrence(monkeypatch):
    """Sert à distinguer un problème EN COURS d'un problème ANCIEN (bruit de démarrage, constaté le 27.10.2026)."""
    import time
    now = time.time()
    t = lambda minutes_ago: str(int((now - minutes_ago * 60) * 1e9))   # noqa: E731
    monkeypatch.setattr(pb.clients, "logs_range", lambda q, m, l: {"data": {"result": [
        {"stream": {"pod": "p1"}, "values": [[t(2), GATEWAY_500], [t(12), GATEWAY_500], [t(25), GATEWAY_500]]}]}})
    c = pb.find_problems("mimir", 30)["categories"]["requete_en_echec"]
    assert c["lignes"] == 3
    assert c["derniere_il_y_a_min"] in (1, 2) and c["premiere_il_y_a_min"] in (24, 25)


def test_age_min_unreadable_timestamp():
    import time
    assert pb._age_min("pas-un-nombre", time.time()) is None


def test_find_problems_query_excludes_the_assistants_own_queries(monkeypatch):
    """Constaté le 27.10.2026 : Loki journalise le texte de nos requêtes, qui contient « status=failed » et « error »."""
    seen = {}
    def fake(q, m, l):
        seen["q"] = q
        return {"data": {"result": []}}
    monkeypatch.setattr(pb.clients, "logs_range", fake)
    pb.find_problems("loki", 30)
    assert seen["q"].startswith('{namespace="loki"} !~ `(\\(\\?i\\)|%28%3Fi%29)` |~ `')
    # La ligne réelle relevée sur AWS (début) est bien celle que l'exclusion vise.
    import re
    own = 'level=info component=querier query="{namespace=\\"loki\\"} |~ \\"(?i)(status=failed|status_code=[45]'
    assert re.search(r"(\(\?i\)|%28%3Fi%29)", own)
