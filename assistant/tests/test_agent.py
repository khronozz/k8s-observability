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
    assert all(t.name in {"promql_instant", "promql_range", "metric_label_values", "search_logs", "log_label_values", "find_problems_in_namespace", "describe_pod"}
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
    assert q == '{namespace="mimir"} | pod=~"mimir-compactor.*" |~ `(?i)status=failed`'
    assert ag.build_logql("mimir", pod_exact="mimir-ruler-1") == '{namespace="mimir"} | pod="mimir-ruler-1"'


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


def test_usual_metrics_line_lists_present_and_absent():
    from app import agent
    line = agent.usual_metrics_line(["up", "kube_pod_status_phase", "autre_metrique"])
    present, absent = line.split("\n")
    assert "PRÉSENTES" in present and "kube_pod_status_phase" in present and "node_memory_MemAvailable_bytes" not in present
    assert "ABSENTES" in absent and "node_memory_MemAvailable_bytes" in absent and "up," not in absent.replace("up", "up,", 0)


def test_cluster_context_includes_usual_metrics_and_survives_failure(monkeypatch):
    from app import agent, clients
    monkeypatch.setattr(agent, "_ctx_cache", None)
    monkeypatch.setattr(clients, "metrics_label_values", lambda label: {"data": ["x"]})
    monkeypatch.setattr(clients, "logs_labels", lambda: {"data": ["namespace"]})
    monkeypatch.setattr(clients, "logs_label_values", lambda label: {"data": ["mimir"]})
    monkeypatch.setattr(clients, "metrics_names", lambda: {"data": ["container_memory_working_set_bytes"]})
    ctx = agent.cluster_context(ttl_s=0)
    assert "PRÉSENTES dans Mimir : container_memory_working_set_bytes" in ctx
    def boom():
        raise clients.UpstreamError("Mimir injoignable")
    monkeypatch.setattr(clients, "metrics_names", boom)
    assert "liste indisponible" in agent.cluster_context(ttl_s=0)


def test_system_prompt_formats_with_context():
    from app import agent
    text = agent.SYSTEM_PROMPT.format(context="CTX")
    assert 'phase="Running"' in text and "CTX" in text


def test_search_logs_excludes_the_assistants_own_queries(monkeypatch):
    from app import agent, clients
    seen = {}
    def fake(q, m, l):
        seen["q"] = q
        return {"data": {"result": []}}
    monkeypatch.setattr(clients, "logs_range", fake)
    out = agent.search_logs.invoke({"namespace": "loki", "contains": "error"})
    assert "(?i)error" in seen["q"] and seen["q"].endswith("`(\\(\\?i\\)|%28%3Fi%29)`")
    assert "requête LogQL" in out


def test_chat_prints_a_trace_of_tool_calls(capsys):
    """Le journal du conteneur doit montrer les outils appelés et leur résultat (diagnostic d'une réponse fausse)."""
    from langchain_core.messages import AIMessage, ToolMessage
    from app import agent

    class FakeAgent:
        def invoke(self, payload, config=None):
            return {"messages": [
                AIMessage(content="", tool_calls=[{"name": "promql_instant", "args": {"query": "up"}, "id": "t1"}]),
                ToolMessage(content="1 série", tool_call_id="t1"),
                AIMessage(content="Réponse finale"),
            ]}

    res = agent.chat([("user", "Où est le pod ?")], agent=FakeAgent())
    out = capsys.readouterr().out
    assert out.startswith("TRACE ") and '"promql_instant"' in out and "1 série" in out and "Où est le pod" in out
    assert res["answer"] == "Réponse finale"


class _SeqAgent:
    """Faux agent : renvoie les réponses données, dans l'ordre, et garde les conversations reçues."""
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def invoke(self, payload, config=None):
        self.calls.append(payload["messages"])
        return {"messages": self.replies.pop(0)}


def _no_tool(text):
    from langchain_core.messages import AIMessage
    return [AIMessage(content=text)]


def _with_tool(text):
    from langchain_core.messages import AIMessage, ToolMessage
    return [AIMessage(content="", tool_calls=[{"name": "promql_instant", "args": {"query": "up"}, "id": "t1"}]),
            ToolMessage(content="ok", tool_call_id="t1"), AIMessage(content=text)]


def test_chat_retries_once_when_absence_is_claimed_without_any_tool(capsys):
    from app import agent
    fake = _SeqAgent([_no_tool("Aucun pod de ce nom. Vérifications effectuées."), _with_tool("Le pod existe, il redémarre.")])
    res = agent.chat([("user", "Décris le pod appli-demo")], agent=fake)
    assert res["answer"] == "Le pod existe, il redémarre." and len(fake.calls) == 2
    assert "aucun outil" in fake.calls[1][-1][1] and '"retried": true' in capsys.readouterr().out


def test_chat_does_not_retry_a_refusal_or_an_answer_that_used_a_tool():
    from app import agent
    refus = _SeqAgent([_no_tool("Je suis limité à la supervision du cluster.")])
    assert agent.chat([("user", "Quelle météo ?")], agent=refus)["answer"].startswith("Je suis limité") and len(refus.calls) == 1
    outil = _SeqAgent([_with_tool("Aucun pod en échec.")])
    agent.chat([("user", "Des pods en échec ?")], agent=outil)
    assert len(outil.calls) == 1


def test_prompt_says_context_does_not_list_pods():
    from app import agent
    assert "ne liste PAS les pods" in agent.SYSTEM_PROMPT


def _tool_named(name, text):
    from langchain_core.messages import AIMessage, ToolMessage
    return [AIMessage(content="", tool_calls=[{"name": name, "args": {}, "id": "t9"}]),
            ToolMessage(content="ok", tool_call_id="t9"), AIMessage(content=text)]


def test_chat_retries_when_a_pod_absence_is_proved_only_by_logs(capsys):
    """F3 du 27.10.2026 : « Aucun pod `base-de-donnees` n'existe », tiré de recherches de logs vides."""
    from app import agent
    fake = _SeqAgent([_tool_named("search_logs", "Aucun pod `base-de-donnees` n'existe."),
                      _tool_named("describe_pod", "Pas de pod base-de-donnees (describe_pod : trouve=false).")])
    res = agent.chat([("user", "Analyse de cause racine ?")], agent=fake)
    assert len(fake.calls) == 2 and "describe_pod" in fake.calls[1][-1][1] and "trouve=false" in res["answer"]


def test_chat_keeps_a_pod_absence_proved_by_metrics_or_unrelated_wording():
    from app import agent
    prouve = _SeqAgent([_tool_named("describe_pod", "Aucun pod `base-de-donnees` n'existe (describe_pod).")])
    agent.chat([("user", "q")], agent=prouve)
    assert len(prouve.calls) == 1
    autre = _SeqAgent([_tool_named("find_problems_in_namespace", "Aucun pod en échec dans mimir.")])
    agent.chat([("user", "q")], agent=autre)
    assert len(autre.calls) == 1


def test_prompt_demands_findings_and_hypotheses_and_forbids_proof_by_empty_logs():
    from app import agent
    assert "« Constats »" in agent.SYSTEM_PROMPT and "« Hypothèses »" in agent.SYSTEM_PROMPT
    assert "ne prouvent PAS" in agent.SYSTEM_PROMPT and "`chronologie_texte`" in agent.SYSTEM_PROMPT and "routine" in agent.SYSTEM_PROMPT
