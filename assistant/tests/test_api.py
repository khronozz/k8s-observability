"""Tests avec Mimir/Loki simulés (httpx.MockTransport) : vérifient le contrat du service, PAS le
comportement réel de Mimir/Loki (qui reste à valider sur le cluster)."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import clients, config
from app.main import app

client = TestClient(app)
calls = []


@pytest.fixture(autouse=True)
def fake_upstream(monkeypatch):
    calls.clear()

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        p = req.url.path
        if not p.startswith("/loki") and (p.endswith("/api/v1/query") or p.endswith("/api/v1/query_range")):
            if req.url.params["query"] == "bad(":
                return httpx.Response(400, text="parse error")
            res = [{"metric": {"i": str(i)}, "value": [1, "1"]} for i in range(120)]
            return httpx.Response(200, json={"status": "success", "data": {"resultType": "vector", "result": res}})
        if p.endswith("/loki/api/v1/query_range"):
            streams = [{"stream": {"pod": "a"}, "values": [["3", "c"], ["1", "a"]]},
                       {"stream": {"pod": "b"}, "values": [["2", "b"]]}]
            return httpx.Response(200, json={"status": "success", "data": {"resultType": "streams", "result": streams}})
        return httpx.Response(200, json={"status": "success", "data": ["x"]})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(clients.httpx, "get",
                        lambda url, params=None, timeout=None: httpx.Client(transport=transport).get(url, params=params))


def test_series_capped():
    r = client.get("/metrics/query", params={"query": "up"}).json()
    assert r["series_total"] == 120 and r["series_returned"] == config.MAX_SERIES


def test_bad_query_returns_400_with_reason():
    r = client.get("/metrics/query", params={"query": "bad("})
    assert r.status_code == 400 and "parse error" in r.json()["detail"]


def test_logs_sorted_and_limited():
    r = client.get("/logs/query", params={"query": '{pod="a"}', "limit": 2}).json()
    assert [l["line"] for l in r["lines"]] == ["c", "b"]


def test_logs_limit_capped():
    client.get("/logs/query", params={"query": "{a=\"b\"}", "limit": 10_000})
    assert calls[-1].url.params["limit"] == str(config.MAX_LOG_LINES)


def test_range_capped():
    client.get("/metrics/range", params={"query": "up", "minutes": 10**6})
    p = calls[-1].url.params
    assert float(p["end"]) - float(p["start"]) <= config.MAX_RANGE_HOURS * 3600 + 1


def test_only_get_requests():
    client.get("/metrics/query", params={"query": "up"})
    client.get("/logs/labels")
    assert all(c.method == "GET" for c in calls)


def test_series_sorted_before_cut(monkeypatch):
    from app.main import _series_summary
    res = [{"metric": {"i": str(i)}, "value": [1, str(i)]} for i in range(120)]  # la plus grande est la dernière
    out = _series_summary(res)
    assert out["series"][0]["metric"]["i"] == "119" and out["series_returned"] == config.MAX_SERIES


def test_metrics_query_adds_lisible_only_for_bytes():
    r = client.get("/metrics/query", params={"query": 'sum by (pod) (container_memory_working_set_bytes)'}).json()
    assert r["series"][0]["lisible"] == "1 B"      # le faux Mimir renvoie « 1 » pour toutes les séries
    assert "lisible" not in client.get("/metrics/query", params={"query": "up"}).json()["series"][0]


def test_tools_spec_exposes_only_ask():
    spec = client.get("/tools/openapi.json").json()
    assert list(spec["paths"]) == ["/ask"]
    assert spec["servers"][0]["url"].endswith("/tools")
    assert spec["paths"]["/ask"]["post"]["operationId"] == "ask_cluster_assistant"


def test_ask_via_tools_app(monkeypatch):
    from app import agent
    monkeypatch.setattr(agent, "ask", lambda q: {"answer": "ok:" + q, "tool_calls": [], "llm_calls": []})
    r = client.post("/tools/ask", json={"question": "salut"})
    assert r.status_code == 200 and r.json()["answer"] == "ok:salut"
    assert client.post("/ask", json={"question": "x"}).status_code == 200
