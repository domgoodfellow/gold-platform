"""Translation between GOLD's transcript and the Interactions API's step/input shape, mocked at
the SDK boundary -- nothing here makes a real request. Field names are checked against the
installed `google-genai` SDK's own generated types
(`google.genai._gaos.types.interactions.{functioncallstep,functionresultstep,modeloutputstep,interaction}`),
quoted in the adapter's own docstring; where the SDK returns typed objects, plain `SimpleNamespace`
stands in for them since this adapter only ever reads attributes off a step, never a concrete
class.
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


class _FakeInteractions:
    def __init__(self, results=None, error=None) -> None:
        self._results = list(results or [])
        self._error = error
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        # The last result repeats if a test calls create() more times than it queued -- most
        # single-turn tests only ever queue one and never notice.
        return self._results[len(self.calls) - 1] if len(self.calls) <= len(self._results) else self._results[-1]


class _FakeClient:
    def __init__(self, results=None, error=None) -> None:
        self.interactions = _FakeInteractions(results, error)


def _step(*, type=None, name=None, arguments=None, id=None, dump=None):  # noqa: A002 - matches the vendor's own field name
    step = SimpleNamespace(type=type, name=name, arguments=arguments, id=id)
    step.model_dump = dump if dump is not None else (lambda: {"type": type, "name": name, "arguments": arguments, "id": id})
    return step


def _interaction(*, output_text="", steps=None, status=None, errors=None):
    return SimpleNamespace(output_text=output_text, steps=steps if steps is not None else [], status=status, errors=errors)


def _install(monkeypatch, *, interaction=None, interactions=None, error=None):
    results = interactions if interactions is not None else ([interaction] if interaction is not None else [])
    fake = _FakeClient(results=results, error=error)
    monkeypatch.setattr(google_answering.genai, "Client", lambda api_key: fake)
    return fake


def test_a_plain_answer_becomes_a_turn_with_no_calls(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Two jobs overran."))

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn == Turn(text="Two jobs overran.", calls=())
    assert fake.interactions.calls[0]["model"] == "gemini-test"
    assert provider.name == "gemini-test"


def test_a_function_call_step_is_read_off_the_interaction(monkeypatch) -> None:
    _install(
        monkeypatch,
        interaction=_interaction(steps=[_step(type="function_call", id="call-1", name="work_at_risk", arguments={"days": 3})]),
    )

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn.calls == (ToolCall(name="work_at_risk", arguments={"days": 3}, reference="call-1"),)


def test_multiple_calls_in_one_turn_are_all_read(monkeypatch) -> None:
    _install(
        monkeypatch,
        interaction=_interaction(
            steps=[
                _step(type="function_call", id="call-1", name="work_at_risk", arguments={}),
                _step(type="function_call", id="call-2", name="work_at_risk", arguments={"days": 7}),
            ]
        ),
    )

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert len(turn.calls) == 2
    assert turn.calls[1].arguments == {"days": 7}


def test_a_stringified_arguments_payload_is_parsed_defensively(monkeypatch) -> None:
    _install(
        monkeypatch,
        interaction=_interaction(steps=[_step(type="function_call", id="call-1", name="work_at_risk", arguments='{"days": 2}')]),
    )

    provider = gemini_provider(api_key="k", model="gemini-test")
    turn = provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert turn.calls[0].arguments == {"days": 2}


def test_a_tool_result_is_sent_back_as_a_function_result_item_keyed_by_call_id(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Done."))

    provider = gemini_provider(api_key="k", model="gemini-test")
    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call-1"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call-1"), rows=[{"a": 1}]),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    sent = fake.interactions.calls[0]["input"]
    call_item = next(item for item in sent if item.get("type") == "function_call")
    result_item = next(item for item in sent if item.get("type") == "function_result")
    assert call_item == {"type": "function_call", "id": "call-1", "name": "work_at_risk", "arguments": {}}
    assert result_item["call_id"] == "call-1"
    assert result_item["name"] == "work_at_risk"
    assert result_item["is_error"] is False
    assert '"a": 1' in result_item["result"]


def test_a_tool_error_result_is_sent_back_with_is_error_true(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Could not."))

    provider = gemini_provider(api_key="k", model="gemini-test")
    history = (
        Exchange(
            turn=Turn(calls=(ToolCall(name="work_at_risk", arguments={}, reference="call-1"),)),
            results=(ToolResult(call=ToolCall(name="work_at_risk", arguments={}, reference="call-1"), error="permission denied"),),
        ),
    )

    provider.next_turn(question="Anything else?", tools=TOOLS, history=history)

    result_item = next(item for item in fake.interactions.calls[0]["input"] if item.get("type") == "function_result")
    assert result_item["result"] == "permission denied"
    assert result_item["is_error"] is True


def test_prior_turns_reach_the_input_as_user_input_and_model_output_items(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Noted."))
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(
        question="Move the first",
        tools=(),
        history=(),
        prior_turns=(PriorTurn(question="What is late?", answer="Two jobs."),),
    )

    sent = fake.interactions.calls[0]["input"]
    assert sent[0] == {"type": "user_input", "content": [{"type": "text", "text": "What is late?"}]}
    assert sent[1] == {"type": "model_output", "content": [{"type": "text", "text": "Two jobs."}]}


def test_context_reaches_system_instruction_not_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Noted."))
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(question="What is late?", tools=(), history=(), context="Today is Thursday.")

    assert "Today is Thursday." in fake.interactions.calls[0]["system_instruction"]
    question_item = fake.interactions.calls[0]["input"][0]
    assert question_item["content"][0]["text"] == "What is late?"


def test_the_public_deployment_prefix_selects_the_public_system_prompt(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Ask a human."))
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(
        question="Are you open Sunday?", tools=(), history=(), context="PUBLIC WEBSITE DEPLOYMENT\nHours info."
    )

    assert fake.interactions.calls[0]["system_instruction"].startswith(google_answering.PUBLIC_SYSTEM)


def test_attachments_are_rendered_and_quoted_alongside_the_question(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Read it."))
    provider = gemini_provider(api_key="k", model="gemini-test")
    files = (AttachedText(name="jobs.csv", mime_type="text/csv", text="id,title\n1,Fence"),)

    provider.next_turn(question="Summarise", tools=(), history=(), attachments=files)

    question_item = fake.interactions.calls[0]["input"][0]
    assert any("jobs.csv" in part["text"] for part in question_item["content"])


def test_tool_declarations_are_translated_to_the_interactions_shape(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Noted."))
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(question="What is late?", tools=TOOLS, history=())

    assert fake.interactions.calls[0]["tools"] == [
        {"type": "function", "name": "work_at_risk", "description": "d", "parameters": {"type": "object", "properties": {}}}
    ]


def test_never_uses_previous_interaction_id_or_store(monkeypatch) -> None:
    fake = _install(monkeypatch, interaction=_interaction(output_text="Noted."))
    provider = gemini_provider(api_key="k", model="gemini-test")

    provider.next_turn(question="What is late?", tools=(), history=())

    assert "previous_interaction_id" not in fake.interactions.calls[0]
    assert fake.interactions.calls[0]["store"] is False


def test_an_sdk_error_is_raised_with_its_own_words(monkeypatch) -> None:
    _install(monkeypatch, error=RuntimeError("rate limited"))
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="rate limited"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_no_output_text_is_an_empty_answer_not_a_failure(monkeypatch) -> None:
    _install(monkeypatch, interaction=_interaction(output_text=""))
    provider = gemini_provider(api_key="k", model="gemini-test")

    turn = provider.next_turn(question="What is late?", tools=(), history=())

    assert turn == Turn(text="", calls=())


def test_a_failed_status_raises_with_the_vendors_own_error_message(monkeypatch) -> None:
    _install(
        monkeypatch,
        interaction=_interaction(status="failed", errors=[SimpleNamespace(message="content blocked")]),
    )
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="content blocked"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_a_cancelled_status_with_no_error_message_still_raises(monkeypatch) -> None:
    _install(monkeypatch, interaction=_interaction(status="cancelled", errors=[]))
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="cancelled"):
        provider.next_turn(question="What is late?", tools=(), history=())


@pytest.mark.parametrize("status", [None, "completed", "requires_action"])
def test_ordinary_statuses_do_not_raise(monkeypatch, status) -> None:
    _install(monkeypatch, interaction=_interaction(output_text="fine", status=status))
    provider = gemini_provider(api_key="k", model="gemini-test")

    turn = provider.next_turn(question="What is late?", tools=(), history=())

    assert turn.text == "fine"


def test_an_in_progress_status_raises_rather_than_being_read_as_a_finished_turn(monkeypatch) -> None:
    # A synchronous, non-streaming, non-backgrounded call that comes back in_progress has not
    # actually finished -- reading a Turn out of it would risk a partial answer read as a complete
    # one.
    _install(monkeypatch, interaction=_interaction(output_text="partial", status="in_progress"))
    provider = gemini_provider(api_key="k", model="gemini-test")

    with pytest.raises(RuntimeError, match="in_progress"):
        provider.next_turn(question="What is late?", tools=(), history=())


def test_thought_and_function_call_steps_are_resent_verbatim_and_never_leak_into_turn_text(monkeypatch) -> None:
    """The scenario the correction names directly: a thought step, a function_call, a
    function_result, and a subsequent completed answer -- across two calls on the *same* provider
    instance, exactly as `app.ai.loop` drives one within a single `answer()`.
    """
    thought_step = _step(type="thought", dump=lambda: {"type": "thought", "content": "secret reasoning nobody downstream should see"})
    call_step = _step(type="function_call", id="call-1", name="work_at_risk", arguments={})

    first = _interaction(steps=[thought_step, call_step], status="requires_action")
    second = _interaction(output_text="Two jobs overran.", status="completed")
    fake = _install(monkeypatch, interactions=[first, second])

    provider = gemini_provider(api_key="k", model="gemini-test")

    turn1 = provider.next_turn(question="What is late?", tools=TOOLS, history=())
    assert turn1.calls == (ToolCall(name="work_at_risk", arguments={}, reference="call-1"),)
    # The thought step's content must never reach anything this adapter hands back.
    assert "secret reasoning" not in turn1.text
    assert "secret reasoning" not in str(turn1)

    history = (
        Exchange(
            turn=turn1,
            results=(ToolResult(call=turn1.calls[0], rows=[{"a": 1}]),),
        ),
    )
    turn2 = provider.next_turn(question="What is late?", tools=TOOLS, history=history)
    assert turn2.text == "Two jobs overran."
    assert "secret reasoning" not in turn2.text

    sent = fake.interactions.calls[1]["input"]
    # Resent verbatim -- the exact dump, not a GOLD reconstruction -- thought content included.
    assert {"type": "thought", "content": "secret reasoning nobody downstream should see"} in sent
    assert {"type": "function_call", "id": "call-1", "name": "work_at_risk", "arguments": {}} in sent
    # The result is still GOLD's own construction; Gemini never produced it.
    result_item = next(item for item in sent if item.get("type") == "function_result")
    assert result_item["call_id"] == "call-1"
    assert '"a": 1' in result_item["result"]
