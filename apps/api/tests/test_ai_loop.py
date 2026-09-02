"""The loop, and the four claims that are this runtime's to make.

Everything about *what a tool may see* lives in Postgres and is tested there against real RLS by
`apps/web/tests/ai-tools.test.ts` — the volatility of every registered function, the argument
that does not narrow, the portal customer who gets nothing. What belongs here is the half that
is a fact about this process:

  * it mints no token and forwards the caller's;
  * it stops, rather than looping while a model keeps asking;
  * it records what a tool was called with and how many rows came back, never the rows;
  * a provider that fails is a recorded failure rather than an exception reaching a person.

These do **not** run in `pnpm --filter @gold/web check`. Run `python -m pytest apps/api/tests`
alongside it — the gap is named in `apps/api/README.md`.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai import Exchange, Tool, ToolCall, Turn  # noqa: E402
from app.ai import loop as loop_module  # noqa: E402
from app.ai.actions import ACTIONS, action_named  # noqa: E402
from app.ai.loop import MAX_TURNS, answer  # noqa: E402
from app.ai.tools import TOOLS, tool_named  # noqa: E402
from app.core import caller  # noqa: E402
from app.core.caller import ToolFailed  # noqa: E402
from app.core.config import AssistantSettings  # noqa: E402

SETTINGS = AssistantSettings(supabase_url="http://db.test", supabase_anon_key="anon")


class Scripted:
    """A provider that says what it was told to say, one turn at a time."""

    name = "scripted"

    def __init__(self, *turns: Turn) -> None:
        self.turns = list(turns)
        self.seen: list[tuple[str, tuple[Exchange, ...]]] = []

    def next_turn(
        self, *, question: str, tools: tuple[Tool, ...], history: tuple[Exchange, ...]
    ) -> Turn:
        self.seen.append((question, history))
        if not self.turns:
            return Turn(text="nothing further")
        return self.turns.pop(0)


def call(name: str, **arguments) -> ToolCall:
    return ToolCall(name=name, arguments=arguments, reference=f"ref-{name}")


def test_forwards_the_callers_token_and_mints_nothing(monkeypatch) -> None:
    # The security property of this whole axis, asserted as the absence it is: there is no role
    # here, nothing is signed, and what reaches Postgres is the token `apps/web` was already
    # holding for the person who asked (D34).
    seen: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: A002
        seen["url"] = url
        seen["authorization"] = headers["Authorization"]

        class Response:
            status_code = 200

            @staticmethod
            def json():
                return [{"title": "Overran"}]

        return Response()

    monkeypatch.setattr(caller.httpx, "post", fake_post)

    rows = caller.call_tool(
        SETTINGS, token="the-operators-own", function="work_at_risk", arguments={}
    )

    assert rows == [{"title": "Overran"}]
    assert seen["authorization"] == "Bearer the-operators-own"
    assert seen["url"] == "http://db.test/rest/v1/rpc/work_at_risk"

    # Nothing in this module knows how to sign anything. The two machine writers import
    # `machine_token`; this one must not, or the absence above is one import from being lost.
    assert "machine_token" not in inspect.getsource(caller)


def test_records_what_was_called_and_never_what_came_back(monkeypatch) -> None:
    monkeypatch.setattr(
        caller.httpx,
        "post",
        lambda *a, **k: type(
            "Response",
            (),
            {
                "status_code": 200,
                "json": staticmethod(
                    lambda: [{"title": "Kraan overran", "customer": "Somebody"}]
                ),
            },
        )(),
    )

    provider = Scripted(
        Turn(calls=(call("work_at_risk", organization_id="an-id"),)),
        Turn(text="One job ran past its window."),
    )

    given = answer(SETTINGS, provider, question="What is late?", token="t")

    assert given.outcome == "answered"
    assert given.text == "One job ran past its window."

    (record,) = given.tools
    assert record.tool == "work_at_risk"
    assert record.arguments == {"organization_id": "an-id"}
    assert record.rows == 1

    # The whole of the rule: a row count, and no row. A run is readable by one person and the
    # tables it read are not, so anything copied here would be a second copy under the wrong
    # policies.
    assert "Kraan overran" not in str(record)
    assert "Somebody" not in str(record)


def test_hands_the_databases_refusal_back_rather_than_failing_the_run(monkeypatch) -> None:
    def refuse(*_args, **_kwargs):
        raise ToolFailed("permission denied for table work_items")

    # Patched where the loop looks it up rather than where it is defined: `loop.py`
    # imported the name, so rebinding it on `caller` would change nothing.
    monkeypatch.setattr(loop_module, "call_tool", refuse)

    provider = Scripted(
        Turn(calls=(call("work_at_risk", organization_id="an-id"),)),
        Turn(text="I could not read that."),
    )

    given = answer(SETTINGS, provider, question="What is late?", token="t")

    # A question about something the caller may not see is an ordinary event, and the useful
    # answer is the database's own sentence — recorded, and handed back so the model can say so.
    assert given.outcome == "answered"
    assert given.tools[0].error == "permission denied for table work_items"

    (_question, history) = provider.seen[1]
    assert history[0].results[0].error == "permission denied for table work_items"


def test_a_name_nothing_matches_is_an_answer_rather_than_a_crash() -> None:
    provider = Scripted(
        Turn(calls=(call("revenue_by_customer", organization_id="an-id"),)),
        Turn(text="There is no tool for that yet."),
    )

    given = answer(SETTINGS, provider, question="What sells best?", token="t")

    assert given.outcome == "answered"
    assert given.tools[0].error == "no tool by that name"
    assert tool_named("revenue_by_customer") is None


def test_stops_at_the_cap(monkeypatch) -> None:
    monkeypatch.setattr(loop_module, "call_tool", lambda *a, **k: [])

    # A model that asks forever. Uncapped, this is a bill nobody agreed to.
    class Insistent:
        name = "insistent"
        asked = 0

        def next_turn(self, **_kwargs) -> Turn:
            Insistent.asked += 1
            return Turn(calls=(call("work_at_risk", organization_id="an-id"),))

    given = answer(SETTINGS, Insistent(), question="What is late?", token="t")

    assert Insistent.asked == MAX_TURNS
    # Nothing broke, so this is not a failure: the loop went round and produced nothing worth
    # showing, which is a fact about the question.
    assert given.outcome == "unanswered"


def test_a_provider_that_fails_is_a_recorded_failure() -> None:
    class Broken:
        name = "broken"

        def next_turn(self, **_kwargs) -> Turn:
            raise RuntimeError("the model declined to answer this")

    given = answer(SETTINGS, Broken(), question="What is late?", token="t")

    assert given.outcome == "failed"
    # Their words, kept verbatim (I25).
    assert given.detail == "the model declined to answer this"


def test_every_tool_names_a_function_and_asks_for_the_business() -> None:
    assert TOOLS

    for tool in TOOLS:
        assert tool.function
        # Which business is an argument on every tool, and it narrows nothing — RLS does that.
        # It is here so a caller who belongs to two businesses can say which one they mean.
        assert "organization_id" in tool.schema["properties"]
        assert tool.schema["additionalProperties"] is False


def test_an_action_stops_the_loop_and_is_never_performed(monkeypatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(
        loop_module, "call_tool", lambda *a, **k: called.append("ran") or []
    )

    provider = Scripted(
        Turn(
            text="That job overran.",
            calls=(
                call(
                    "propose_reschedule",
                    work_item_id="a-job",
                    starts_at="2026-09-03T09:00:00Z",
                    ends_at="2026-09-03T10:00:00Z",
                    because="It ran past its window yesterday.",
                ),
            ),
        ),
    )

    given = answer(SETTINGS, provider, question="Anything to move?", token="t")

    assert given.action is not None
    assert given.action.name == "propose_reschedule"
    assert given.action.arguments["work_item_id"] == "a-job"
    assert given.action.because == "It ran past its window yesterday."

    # Nothing was dispatched, and there was nothing to dispatch to: an action resolves to no
    # Postgres function, and `apps/web` is what turns one into a write when a person says so.
    assert called == []
    assert action_named("propose_reschedule").function == ""
    assert tool_named("propose_reschedule") is None


def test_an_action_and_a_read_in_one_breath_stops_before_the_read(monkeypatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(
        loop_module, "call_tool", lambda *a, **k: called.append("ran") or []
    )

    # A model proposing a move in the same turn it asks to look is proposing it without having
    # looked. Stopping first means the suggestion a person reads was always made on what the
    # model already knew.
    provider = Scripted(
        Turn(
            calls=(
                call("work_at_risk", organization_id="an-id"),
                call(
                    "propose_reschedule",
                    work_item_id="a-job",
                    starts_at="2026-09-03T09:00:00Z",
                    ends_at="2026-09-03T10:00:00Z",
                    because="Because.",
                ),
            )
        ),
    )

    given = answer(SETTINGS, provider, question="Anything to move?", token="t")

    assert given.action is not None
    assert called == []


def test_actions_are_offered_to_the_model_beside_the_tools() -> None:
    provider = Scripted(Turn(text="Nothing to do."))
    answer(SETTINGS, provider, question="How are things?", token="t")

    # Both lists reach the provider; what separates them is entirely on this side.
    assert {tool.name for tool in TOOLS} | {action.name for action in ACTIONS}
    for action in ACTIONS:
        assert action.function == ""
