"""Mise en forme des octets : valeurs de référence calculées à la main (pas par le code testé)."""
import pytest

from app import agent as ag
from app.units import annotate_series, format_bytes, is_bytes_query


@pytest.mark.parametrize("raw, expected", [
    ("708096000", "675,3 MiB"),      # 708096000 / 1024^2 = 675,3 (valeur réelle d'open-webui-0 le 16.10.2026)
    ("483201024", "460,8 MiB"),      # grafana le 16.10.2026 (le modèle avait affiché « 4,07 GB »)
    ("7160000000", "6,67 GiB"),
    ("0", "0 B"),
    ("1023", "1023 B"),
    ("1024", "1,0 KiB"),
    ("1099511627776", "1,00 TiB"),
    ("-2048", "-2,0 KiB"),
])
def test_format_bytes(raw, expected):
    assert format_bytes(raw) == expected


@pytest.mark.parametrize("raw", ["abc", None, "NaN", "+Inf"])
def test_format_bytes_rejects_non_finite(raw):
    assert format_bytes(raw) is None


@pytest.mark.parametrize("query, expected", [
    ('topk(3, sum by (pod) (container_memory_working_set_bytes{container!=""}))', True),
    ("avg_over_time(container_memory_working_set_bytes[5m])", True),
    ("rate(container_network_receive_bytes_total[5m])", False),     # octets/s, et compteur
    ("count(container_memory_working_set_bytes)", False),            # nombre de séries
    ("sum(a_bytes) / sum(b_bytes)", False),                          # ratio
    ("count(up)", False),
    ("up", False),
])
def test_is_bytes_query(query, expected):
    assert is_bytes_query(query) is expected


def test_annotate_instant_and_range():
    inst = [{"metric": {"pod": "a"}, "value": [1, "708096000"]}]
    annotate_series(inst, "container_memory_working_set_bytes")
    assert inst[0]["lisible"] == "675,3 MiB"
    rng = [{"metric": {"pod": "a"}, "values": [[1, "1048576"], [2, "3145728"], [3, "2097152"]]}]
    annotate_series(rng, "container_memory_working_set_bytes")
    assert rng[0]["lisible_max"] == "3,0 MiB" and rng[0]["lisible_derniere"] == "2,0 MiB"


def test_no_label_when_unit_uncertain():
    inst = [{"metric": {}, "value": [1, "11"]}]
    annotate_series(inst, "count(up)")
    assert "lisible" not in inst[0]


def test_agent_tool_adds_lisible(monkeypatch):
    monkeypatch.setattr(ag.clients, "metrics_instant",
                        lambda q: {"data": {"result": [{"metric": {"pod": "a"}, "value": [1, "708096000"]}]}})
    out = ag.promql_instant.invoke({"query": "topk(3, sum by (pod) (container_memory_working_set_bytes))"})
    assert '"lisible": "675,3 MiB"' in out
    assert "lisible" not in ag.promql_instant.invoke({"query": "count(up)"})


def test_system_prompt_formats_without_error():
    # {context} est le seul champ du prompt : toute accolade ajoutée par erreur casserait .format()
    assert "lisible" in ag.SYSTEM_PROMPT.format(context="x")


def test_system_prompt_limits_label_lookups():
    # 0.4.3 : le modèle appelait metric_label_values(pod) avant chaque classement (liste de pods inutile, +1197 tokens)
    p = ag.SYSTEM_PROMPT.format(context="x")
    assert "n'appelle PAS ces outils" in p and "Si tu hésites, interroge-les d'abord" not in p
