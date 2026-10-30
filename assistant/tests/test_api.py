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


def test_v1_models_lists_public_name():
    r = client.get("/v1/models").json()
    assert r["data"][0]["id"] == config.PUBLIC_MODEL_NAME


def test_v1_chat_completions_plain_and_stream(monkeypatch):
    from app import agent
    seen = {}

    def fake_chat(turns, agent=None):
        seen["turns"] = turns
        return {"answer": "Bonjour", "tool_calls": [],
                "llm_calls": [{"total_s": 0.4, "prompt_tokens": 90, "output_tokens": 10}]}

    monkeypatch.setattr(agent, "chat", fake_chat)
    body = {"model": "m", "messages": [
        {"role": "system", "content": "ignoré"}, {"role": "user", "content": "salut"},
        {"role": "assistant", "content": "ok"}, {"role": "user", "content": [{"type": "text", "text": "et ?"}]}]}
    r = client.post("/v1/chat/completions", json=body).json()
    assert r["choices"][0]["message"]["content"] == "Bonjour" and r["usage"]["total_tokens"] == 100
    assert seen["turns"] == [("user", "salut"), ("assistant", "ok"), ("user", "et ?")]   # le « system » d'Open WebUI est écarté
    s = client.post("/v1/chat/completions", json={**body, "stream": True})
    assert s.headers["content-type"].startswith("text/event-stream")
    events = [e for e in s.text.split("\n\n") if e]
    assert events[-1] == "data: [DONE]" and '"content": "Bonjour"' in events[0]


def test_v1_chat_completions_rejects_missing_user_turn():
    r = client.post("/v1/chat/completions", json={"messages": [{"role": "assistant", "content": "x"}]})
    assert r.status_code == 422


def test_v1_adds_queries_footer_and_strips_it_from_history(monkeypatch):
    from app import agent
    seen = {}

    def fake_chat(turns, agent=None):
        seen["turns"] = turns
        return {"answer": "Il y a 2 nœuds.",
                "tool_calls": [{"tool": "promql_instant", "args": {"query": 'count(kube_node_info{a="b"})'}, "result": "secret-résultat"}],
                "llm_calls": []}

    monkeypatch.setattr(agent, "chat", fake_chat)
    first = {"messages": [{"role": "user", "content": "combien de nœuds ?"}]}
    content = client.post("/v1/chat/completions", json=first).json()["choices"][0]["message"]["content"]
    assert content.startswith("Il y a 2 nœuds.") and "*Outils appelés (avec leurs arguments) :*" in content
    assert 'promql_instant(query=count(kube_node_info{a="b"}))' in content
    assert "secret-résultat" not in content                      # les résultats ne sont pas repris
    stream = client.post("/v1/chat/completions", json={**first, "stream": True}).text
    assert "Outils appelés" in stream
    # Au tour suivant, Open WebUI renvoie la réponse avec son pied : il ne doit pas atteindre le modèle.
    second = {"messages": [{"role": "user", "content": "combien de nœuds ?"},
                           {"role": "assistant", "content": content}, {"role": "user", "content": "et les pods ?"}]}
    client.post("/v1/chat/completions", json=second)
    assert seen["turns"][1] == ("assistant", "Il y a 2 nœuds.")


def test_v1_no_footer_without_tool_call(monkeypatch):
    from app import agent
    monkeypatch.setattr(agent, "chat", lambda turns, agent=None: {"answer": "Refus.", "tool_calls": [], "llm_calls": []})
    r = client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "météo ?"}]}).json()
    assert r["choices"][0]["message"]["content"] == "Refus."
