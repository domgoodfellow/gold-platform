"""Translation between GOLD's transcript and Gemini's `generate_content` shape, mocked at the SDK
boundary -- nothing here makes a real request.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.ai import AttachedText, Exchange, PriorTurn, Tool, ToolCall, ToolResult, Turn
from app.providers.google import answering as google_answering
from app.providers.google.answering import gemini_provider

TOOLS = (
    Tool(name="work_at_risk", description="d", schema={"type": "object", "properties": {}}, function="work_at_risk"),
)


class _Part:
    def __init__(self, *, text=None, function_call=None) -> None:
        self.text = text
        self.function_call = function_call


def _candidate(*, parts=(), finish_reason=None):
    content = SimpleNamespace(parts=list(parts)) if parts else SimpleNamespace(parts=[])
    return SimpleNamespace(content=content, finish_reason=finish_reason)


class _FakeModels:
    def __init__(self, response=None, error=None) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict] = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._response


class _FakeClient:
    def __init__(self, response=None, error=None) -> None:
        self.models = _FakeModels(response, error)


def _install(monkeypatch, *, candidates=None, error=None):
    response = SimpleNamespace(candidates=candidates if candidates is not None else [])
    fake = _FakeClient(response=response, error=error)
    monkeypatch.setattr(google_answering.genai, "Client", lambda api_key: fake)
    return fake


def test_a_plain_answer_becomes_a_turn_with_no_calls(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Two jobs overran.")])])

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn == Turn(text="Two jobs overran.", calls=())
    assert fake.models.calls[0]["model"] == "gemini-test"
    assert provider.name == "gemini-test"


def test_a_function_call_part_is_read_with_a_synthesised_reference(monkeypatch) -> None:
    call = SimpleNamespace(name="work_at_risk", args={"days": 3})
    _install(monkeypatch, candidates=[_candidate(parts=[_Part(function_call=call)])])

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn.calls == (ToolCall(name="work_at_risk", arguments={"days": 3}, reference="call-0"),)


def test_multiple_calls_in_one_turn_each_get_a_distinct_reference(monkeypatch) -> None:
    parts = [
        _Part(function_call=SimpleNamespace(name="work_at_risk", args={})),
        _Part(function_call=SimpleNamespace(name="work_at_risk", args={"days": 7})),
    ]
    _install(monkeypatch, candidates=[_candidate(parts=parts)])

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert [call.reference for call in turn.calls] == ["call-0", "call-1"]


def test_a_tool_result_is_sent_back_as_a_function_response_part(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Done.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")

    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call-0"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call-0"), rows=[{"a": 1}]),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    contents = fake.models.calls[0]["contents"]
    # One Content for the model's turn (its function call) and one for the result.
    result_content = contents[-1]
    assert result_content.role == "user"
    assert result_content.parts[0].function_response.name == "work_at_risk"
    assert result_content.parts[0].function_response.response == {"rows": [{"a": 1}]}


def test_a_tool_error_result_is_sent_back_as_an_error_field(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Could not.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")

    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call-0"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call-0"), error="permission denied"),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    result_content = fake.models.calls[0]["contents"][-1]
    assert result_content.parts[0].function_response.response == {"error": "permission denied"}


def test_prior_turns_reach_contents_in_order(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Noted.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(
        question="Move the first",
        tools=(),
        history=(),
        prior_turns=(PriorTurn(question="What is late?", answer="Two jobs."),),
    )

    contents = fake.models.calls[0]["contents"]
    assert contents[0].role == "user"
    assert contents[0].parts[0].text == "What is late?"
    assert contents[1].role == "model"
    assert contents[1].parts[0].text == "Two jobs."


def test_context_reaches_the_system_instruction_not_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Noted.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(question="What is late?", tools=(), history=(), context="Today is Thursday.")

    config = fake.models.calls[0]["config"]
    assert "Today is Thursday." in config.system_instruction
    question_content = fake.models.calls[0]["contents"][0]
    assert question_content.parts[0].text == "What is late?"


def test_the_public_deployment_prefix_selects_the_public_system_prompt(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Ask a human.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(
        question="Are you open Sunday?", tools=(), history=(), context="PUBLIC WEBSITE DEPLOYMENT\nHours info."
    )

    config = fake.models.calls[0]["config"]
    assert config.system_instruction.startswith(google_answering.PUBLIC_SYSTEM)


def test_attachments_are_rendered_and_quoted_alongside_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, candidates=[_candidate(parts=[_Part(text="Read it.")])])
    provider = gemini_provider(api_key="k", model="gemini-test")
    files = (AttachedText(name="jobs.csv", mime_type="text/csv", text="id,title\n1,Fence"),)

    provider.next_turn(question="Summarise", tools=(), history=(), attachments=files)

    question_content = fake.models.calls[0]["contents"][0]
    assert any("jobs.csv" in part.text for part in question_content.parts if part.text)


def test_an_sdk_error_is_raised_with_its_own_words(monkeypatch) -> None:
    _install(monkeypatch, error=RuntimeError("rate limited"))
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="rate limited"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_no_candidates_is_a_failure_not_a_blank_answer(monkeypatch) -> None:
    _install(monkeypatch, candidates=[])
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="no answer"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_a_non_ordinary_finish_reason_raises_rather_than_returning_text(monkeypatch) -> None:
    _install(
        monkeypatch,
        candidates=[_candidate(parts=[_Part(text="partial")], finish_reason=SimpleNamespace(name="SAFETY"))],
    )
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="SAFETY"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_max_tokens_finish_reason_is_ordinary(monkeypatch) -> None:
    _install(
        monkeypatch,
        candidates=[_candidate(parts=[_Part(text="cut off")], finish_reason="MAX_TOKENS")],
    )
    provider = gemini_provider(api_key="k", model="gemini-test")

    turn = provider.next_turn(question="What is late?", tools=(), history=())

    assert turn.text == "cut off"
