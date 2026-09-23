"""Translation between GOLD's transcript and the Responses API's, and nothing about OpenAI itself.

The vendor SDK's own HTTP boundary is mocked (`client.responses.create` never really called);
what is asserted is that this adapter renders history/context/attachments correctly, reads a
function call and a refusal correctly, and never lets an OpenAI-shaped object escape as a `Turn`.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.ai import AttachedText, Exchange, PriorTurn, Tool, ToolCall, ToolResult, Turn
from app.providers.openai import answering as openai_answering
from app.providers.openai.answering import openai_provider

TOOLS = (
    Tool(name="work_at_risk", description="d", schema={"type": "object", "properties": {}}, function="work_at_risk"),
)


class _FakeResponses:
    def __init__(self, response) -> None:
        self._response = response
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._response


class _FakeClient:
    def __init__(self, response) -> None:
        self.responses = _FakeResponses(response)


def _response(*, status="completed", output=(), output_text="", error=None, incomplete_details=None):
    return SimpleNamespace(
        status=status, output=list(output), output_text=output_text, error=error, incomplete_details=incomplete_details
    )


def _install(monkeypatch, response):
    fake = _FakeClient(response)
    monkeypatch.setattr(openai_answering.openai, "OpenAI", lambda api_key: fake)
    return fake


def test_a_plain_answer_becomes_a_turn_with_no_calls(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Two jobs overran."))

    provider = openai_provider(api_key="k", model="gpt-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn == Turn(text="Two jobs overran.", calls=())
    assert fake.responses.calls[0]["model"] == "gpt-test"
    assert provider.name == "gpt-test"


def test_a_function_call_is_read_off_the_output(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(
            output=[
                SimpleNamespace(type="function_call", call_id="call_1", name="work_at_risk", arguments="{}"),
            ]
        ),
    )

    provider = openai_provider(api_key="k", model="gpt-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn.calls == (ToolCall(name="work_at_risk", arguments={}, reference="call_1"),)


def test_multiple_calls_in_one_turn_are_all_read(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(
            output=[
                SimpleNamespace(type="function_call", call_id="call_1", name="work_at_risk", arguments="{}"),
                SimpleNamespace(type="function_call", call_id="call_2", name="work_at_risk", arguments='{"days": 3}'),
            ]
        ),
    )

    provider = openai_provider(api_key="k", model="gpt-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert len(turn.calls) == 2
    assert turn.calls[1].arguments == {"days": 3}


def test_a_malformed_arguments_string_becomes_an_empty_dict(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(
            output=[SimpleNamespace(type="function_call", call_id="call_1", name="work_at_risk", arguments="{not json")]
        ),
    )

    provider = openai_provider(api_key="k", model="gpt-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn.calls[0].arguments == {}


def test_a_tool_result_is_sent_back_as_a_matched_function_call_output(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Done."))

    provider = openai_provider(api_key="k", model="gpt-test")
    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call_1"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call_1"), rows=[{"a": 1}]),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    sent = fake.responses.calls[0]["input"]
    call_item = next(item for item in sent if item.get("type") == "function_call")
    result_item = next(item for item in sent if item.get("type") == "function_call_output")
    assert call_item["call_id"] == "call_1"
    assert result_item["call_id"] == "call_1"
    assert '"a": 1' in result_item["output"]


def test_a_tool_errors_result_is_sent_back_as_the_output(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Could not."))

    provider = openai_provider(api_key="k", model="gpt-test")
    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call_1"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call_1"), error="permission denied"),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    result_item = next(item for item in fake.responses.calls[0]["input"] if item.get("type") == "function_call_output")
    assert result_item["output"] == "permission denied"


def test_prior_turns_reach_the_input_in_order(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Noted."))
    provider = openai_provider(api_key="k", model="gpt-test")

    provider.next_turn(
        question="Move the first",
        tools=(),
        history=(),
        prior_turns=(PriorTurn(question="What is late?", answer="Two jobs."),),
    )

    sent = fake.responses.calls[0]["input"]
    assert sent[0] == {"role": "user", "content": "What is late?"}
    assert sent[1] == {"role": "assistant", "content": "Two jobs."}


def test_context_is_appended_to_instructions_not_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Noted."))
    provider = openai_provider(api_key="k", model="gpt-test")

    provider.next_turn(question="What is late?", tools=(), history=(), context="Today is Thursday.")

    assert "Today is Thursday." in fake.responses.calls[0]["instructions"]
    question_item = fake.responses.calls[0]["input"][0]
    assert question_item["content"][0]["text"] == "What is late?"


def test_the_public_deployment_prefix_selects_the_public_system_prompt(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Ask a human."))
    provider = openai_provider(api_key="k", model="gpt-test")

    provider.next_turn(
        question="Are you open Sunday?", tools=(), history=(), context="PUBLIC WEBSITE DEPLOYMENT\nHours info."
    )

    assert fake.responses.calls[0]["instructions"].startswith(openai_answering.PUBLIC_SYSTEM)


def test_attachments_are_rendered_and_quoted_alongside_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, _response(output_text="Read it."))
    provider = openai_provider(api_key="k", model="gpt-test")
    files = (AttachedText(name="jobs.csv", mime_type="text/csv", text="id,title\n1,Fence"),)

    provider.next_turn(question="Summarise", tools=(), history=(), attachments=files)

    question_item = fake.responses.calls[0]["input"][0]
    assert any("jobs.csv" in part["text"] for part in question_item["content"])


def test_a_failed_status_raises_with_the_vendors_own_words(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(status="failed", error=SimpleNamespace(message="insufficient quota")),
    )
    provider = openai_provider(api_key="k", model="gpt-test")

    with pytest.raises(RuntimeError, match="insufficient quota"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_an_incomplete_status_raises_rather_than_returning_a_partial_answer(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(status="incomplete", incomplete_details=SimpleNamespace(reason="max_output_tokens")),
    )
    provider = openai_provider(api_key="k", model="gpt-test")

    with pytest.raises(RuntimeError, match="max_output_tokens"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_a_refusal_item_raises_rather_than_being_returned_as_text(monkeypatch) -> None:
    _install(
        monkeypatch,
        _response(output=[SimpleNamespace(type="refusal", refusal="I can't help with that.")]),
    )
    provider = openai_provider(api_key="k", model="gpt-test")

    with pytest.raises(RuntimeError, match="can't help"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_no_output_text_is_an_empty_answer_not_a_failure(monkeypatch) -> None:
    _install(monkeypatch, _response(output_text=None))
    provider = openai_provider(api_key="k", model="gpt-test")

    turn = provider.next_turn(question="What is late?", tools=(), history=())

    assert turn == Turn(text="", calls=())
