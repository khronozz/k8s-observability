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
