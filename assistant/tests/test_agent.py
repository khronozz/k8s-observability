"""Teste la boucle agent -> outil -> réponse avec un faux modèle (PAS qwen3 : le comportement réel du modèle
n'est pas testé ici)."""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain.agents import create_agent

from app import agent as ag


class FakeToolModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kw):
        return self


def test_agent_calls_tool_then_answers(monkeypatch):
    monkeypatch.setattr(ag.clients, "metrics_instant",
                        lambda q: {"data": {"result": [{"value": [1, "11"]}]}})
    msgs = iter([
        AIMessage(content="", tool_calls=[{"name": "promql_instant", "args": {"query": "count(up)"}, "id": "1"}]),
        AIMessage(content="Il y a 11 cibles up."),
    ])
    a = create_agent(FakeToolModel(messages=msgs), ag.TOOLS, system_prompt="x")
    r = ag.ask("Combien de cibles ?", agent=a)
    assert r["answer"] == "Il y a 11 cibles up."
    assert r["tool_calls"] == [{"tool": "promql_instant", "args": {"query": "count(up)"},
                                "result": '{"data": {"result": [{"value": [1, "11"]}]}}'}]


def test_trace_result_truncated_and_can_be_disabled(monkeypatch):
    from langchain_core.messages import ToolMessage
    msgs = [AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "1"}]),
            ToolMessage(content="x" * 50, tool_call_id="1")]
    monkeypatch.setattr(ag.config, "TRACE_RESULT_CHARS", 10)
    assert ag.tool_trace(msgs)[0]["result"] == "x" * 10 + " ...[tronqué]"
    monkeypatch.setattr(ag.config, "TRACE_RESULT_CHARS", 0)
    assert "result" not in ag.tool_trace(msgs)[0]


def test_tool_error_is_returned_to_model(monkeypatch):
    def boom(q):
        raise ag.UpstreamError("HTTP 400 : parse error", status=400)
    monkeypatch.setattr(ag.clients, "metrics_instant", boom)
    assert ag.promql_instant.invoke({"query": "bad("}).startswith("ERREUR:")


def test_no_write_tools():
    assert all(t.name in {"promql_instant", "promql_range", "metric_label_values", "search_logs", "log_label_values", "find_problems_in_namespace"}
               for t in ag.TOOLS)


def test_compact_logs_short_and_truncated():
    long = "x" * 1000
    data = {"data": {"result": [{"stream": {"namespace": "mimir", "pod": "p", "container": "c",
                                           "detected_level": "info", "junk": "j" * 50},
                                 "values": [["2", long], ["1", "court"]]}]}}
    out = ag.compact_logs(data)
    assert out.startswith("2 ligne(s)") and "junk" not in out and "…" in out
    assert len(out) < 700


def test_llm_stats_from_metadata():
    m = AIMessage(content="x", response_metadata={"total_duration": 3_000_000_000, "load_duration": 1_000_000_000,
                                                  "prompt_eval_count": 100, "prompt_eval_duration": 2_000_000_000,
                                                  "eval_count": 5, "eval_duration": 500_000_000})
    assert ag.llm_stats([AIMessage(content="sans métadonnées"), m]) == [
        {"total_s": 3.0, "load_s": 1.0, "prompt_tokens": 100, "prompt_s": 2.0, "output_tokens": 5, "gen_s": 0.5}]


def test_build_logql_scoped_and_escaped():
    assert ag.build_logql("mimir") == '{namespace="mimir"}'
    q = ag.build_logql("mimir", "mimir-compactor", "status=failed")
    assert q == '{namespace="mimir", pod=~"mimir-compactor.*"} |~ `(?i)status=failed`'


def test_build_logql_rejects_injection():
    import pytest
    for bad in ('mimir"} or {a="b', "", "a b", ".*"):
        with pytest.raises(ValueError):
            ag.build_logql(bad)
    with pytest.raises(ValueError):
        ag.build_logql("mimir", 'x"}')


def test_build_llm_switches_on_provider(monkeypatch):
    import pytest
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")          # faux identifiants : aucun appel réseau à la construction
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setattr(ag.config, "LLM_PROVIDER", "bedrock")
    llm = ag.build_llm()
    assert type(llm).__name__ == "ChatBedrockConverse" and llm.model_id == ag.config.BEDROCK_MODEL_ID
    monkeypatch.setattr(ag.config, "LLM_PROVIDER", "ollama")
    assert type(ag.build_llm()).__name__ == "ChatOllama"
    monkeypatch.setattr(ag.config, "LLM_PROVIDER", "autre")
    with pytest.raises(ValueError):
        ag.build_llm()


def test_llm_stats_bedrock_and_text_blocks():
    m = AIMessage(content="x", usage_metadata={"input_tokens": 91, "output_tokens": 35, "total_tokens": 126},
                  response_metadata={"metrics": {"latencyMs": [439]}})
    assert ag.llm_stats([m]) == [{"total_s": 0.4, "prompt_tokens": 91, "output_tokens": 35}]
    assert ag.text_of([{"type": "text", "text": "a"}, {"type": "tool_use", "name": "t"}, {"type": "text", "text": "b"}]) == "ab"
    assert ag.text_of("plain") == "plain"


def test_chat_takes_history_and_returns_plain_text():
    a = create_agent(FakeToolModel(messages=iter([AIMessage(content=[{"type": "text", "text": "Réponse"}])])),
                     ag.TOOLS, system_prompt="x")
    r = ag.chat([("user", "salut"), ("assistant", "bonjour"), ("user", "et la météo ?")], agent=a)
    assert r["answer"] == "Réponse"


def test_system_prompt_scopes_to_cluster_supervision():
    assert "QUE la supervision" in ag.SYSTEM_PROMPT and "{context}" in ag.SYSTEM_PROMPT
