"""describe_pod : le namespace vient des métriques du pod, les logs sont cherchés dedans (cas F2 du 27.10.2026)."""
import json
import time

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


def _logs_data(ts, line):
    return {"data": {"result": [{"stream": {"namespace": "test-incident", "pod": "appli-demo", "container": "appli-demo"},
                                 "values": [[ts, line]]}]}}


EVENT_LINE = ('name=appli-demo kind=Pod reason=BackOff type=Warning count=267 '
              'msg="Back-off restarting failed container appli-demo in pod appli-demo_test-incident(1941d9e0)" ')


def test_describe_pod_searches_logs_in_the_pods_own_namespace(monkeypatch):
    queries = []
    now_ns = str(int(time.time() * 1e9))

    def logs(q, minutes, limit):
        queries.append((q, minutes))
        if "eventhandler" in q:
            return _logs_data(now_ns, EVENT_LINE)
        return _logs_data(now_ns, "erreur : connexion refusee vers base-de-donnees:5432")
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics())
    monkeypatch.setattr(clients, "logs_range", logs)
    res = pods.describe_pod("appli-demo")
    p = res["pods"][0]
    assert queries[0][0].startswith('{namespace="test-incident"} | pod="appli-demo"') and queries[0][1] == 30
    assert queries[1][0].startswith('{namespace="test-incident"} | job="integrations/kubernetes/eventhandler" | name="appli-demo"')
    assert p["namespace"] == "test-incident" and p["phase"] == "Running" and p["pret"] is False
    assert p["redemarrages_total"] == 10 and p["redemarrages_10_dernieres_min"] == 2
    assert p["derniere_terminaison"] == "Error" and p["attente_10_dernieres_min"] == ["CrashLoopBackOff"]
    assert "connexion refusee vers base-de-donnees:5432" in p["logs_recents"]
    assert p["derniere_ligne_de_log_il_y_a_min"] == 0 and p["logs_fenetre_minutes"] == 30
    ev = p["evenements"][0]
    assert ev["raison"] == "BackOff" and ev["type"] == "Warning" and ev["fois"] == 267 and "Back-off restarting" in ev["message"]


def test_describe_pod_widens_the_log_window_and_reports_the_age_of_the_last_line(monkeypatch):
    old_ns = str(int((time.time() - 64 * 60) * 1e9))
    calls = []

    def logs(q, minutes, limit):
        calls.append(minutes)
        if "eventhandler" in q:
            return {"data": {"result": []}}
        return {"data": {"result": []}} if minutes == 30 else _logs_data(old_ns, "erreur : connexion refusee vers base-de-donnees:5432")
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics())
    monkeypatch.setattr(clients, "logs_range", logs)
    p = pods.describe_pod("appli-demo")["pods"][0]
    assert calls[:2] == [30, 360] and p["logs_fenetre_minutes"] == 360
    assert p["derniere_ligne_de_log_il_y_a_min"] in (63, 64) and "connexion refusee" in p["logs_recents"]
    assert p["evenements"] == []


def test_describe_pod_says_when_no_log_line_exists_at_all(monkeypatch):
    monkeypatch.setattr(clients, "metrics_instant", _fake_metrics())
    monkeypatch.setattr(clients, "logs_range", lambda q, m, l: {"data": {"result": []}})
    p = pods.describe_pod("appli-demo")["pods"][0]
    assert p["logs_recents"] == "aucune ligne" and "non vérifiée" in p["logs_note"]


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
