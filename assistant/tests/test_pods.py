"""describe_pod : le namespace vient des métriques du pod, les logs sont cherchés dedans (cas F2 du 27.10.2026)."""
import json

import pytest

from app import agent, clients, pods


def _series(ns, pod, value="1", **labels):
    return {"metric": {"namespace": ns, "pod": pod, **labels}, "value": [1.0, value]}


def _fake_metrics(found=True):
    def fake(q):
        if not found:
            return {"data": {"result": []}}
        if "kube_pod_status_phase" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", phase="Running")]}}
        if "status_ready" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", value="0")]}}
        if "increase(" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", value="1.9")]}}
        if "restarts_total" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", value="10")]}}
        if "last_terminated_reason" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", reason="Error")]}}
        if "waiting_reason" in q:
            return {"data": {"result": [_series("test-incident", "appli-demo", reason="CrashLoopBackOff")]}}
        raise AssertionError(q)
    return fake


def test_describe_pod_searches_logs_in_the_pods_own_namespace(monkeypatch):
    seen = {}

    def logs(q, minutes, limit):
        seen["q"] = q
        return {"data": {"result": [{"stream": {"namespace": "test-incident", "pod": "appli-demo", "container": "appli-demo"},
                                     "values": [["1793095458000000000", "erreur : connexion refusee vers base-de-donnees:5432"]]}]}}
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics())
    monkeypatch.setattr(clients, "logs_range", logs)
    res = pods.describe_pod("appli-demo")
    p = res["pods"][0]
    assert seen["q"].startswith('{namespace="test-incident", pod=~"appli-demo.*"}')
    assert p["namespace"] == "test-incident" and p["phase"] == "Running" and p["pret"] is False
    assert p["redemarrages_total"] == 10 and p["redemarrages_10_dernieres_min"] == 2
    assert p["derniere_terminaison"] == "Error" and p["attente_10_dernieres_min"] == ["CrashLoopBackOff"]
    assert "connexion refusee vers base-de-donnees:5432" in p["logs_recents"]


def test_describe_pod_unknown_pod_says_so(monkeypatch):
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics(found=False))
    res = pods.describe_pod("inconnu")
    assert res["trouve"] is False and "n'existe pas" in res["note"]


def test_describe_pod_rejects_a_prefix_that_is_not_a_pod_name():
    with pytest.raises(ValueError):
        pods.describe_pod('x"} or vector(1) #')


def test_describe_pod_tool_returns_an_error_text_instead_of_raising():
    assert agent.describe_pod.invoke({"pod_prefix": "Pas Valable"}).startswith("ERREUR")


def test_describe_pod_is_a_tool_and_the_prompt_asks_for_it(monkeypatch):
    assert agent.describe_pod in agent.TOOLS and "describe_pod" in agent.SYSTEM_PROMPT
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics())
    monkeypatch.setattr(clients, "logs_range", lambda q, m, l: {"data": {"result": []}})
    assert json.loads(agent.describe_pod.invoke({"pod_prefix": "appli-demo"}))["trouve"] is True
