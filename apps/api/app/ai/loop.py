"""The tool loop: ask, call what was asked for, ask again, stop.

**One loop, above every provider.** Iteration, dispatch, the cap and what gets recorded all live
here, and a provider only ever answers *what is the next turn*. Building on a vendor SDK's own
tool-runner would have been less code and would have meant a second loop the first time a
business ran a local model -- two dispatch paths and an `agent_runs` row whose meaning depended
on who answered it (D34).

**Nothing in here decides what the caller may see.** Every tool runs under the operator's own
token, so the rows that come back are the rows their browser would show them. This module does
not filter, sort or trim an answer, and must not start: the moment it does, this runtime is
making an authorization decision, and there is nowhere to write that decision down.

**Nothing in here computes.** No total, no average, no ranking. A question that needs one has no
tool yet and is answered by saying so -- see `app.ai.tools` for why that is a decision rather
than a gap.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.ai import AnsweringProvider, Exchange, Tool, ToolCall, ToolResult, Turn
from app.ai.actions import ACTIONS, action_named
from app.ai.tools import TOOLS, tool_named
from app.core.caller import ToolFailed, call_tool
from app.core.config import AssistantSettings

# **A cap rather than a budget.** Every tool here answers in one call, so a question needing
# more than a handful of turns is a model going in circles rather than a hard question -- and an
# uncapped loop against a metered provider is a bill nobody agreed to.
MAX_TURNS = 6


@dataclass(frozen=True)
class ToolRecord:
    """What one tool call was, for the run row.

    **The name, the arguments and how many rows came back. Never the rows.** A run is readable
    by the person who made it and by nobody else, and the cheapest way to break that is to
    snapshot tenant data into a second table where the original row's own policies no longer
    apply. What was asked survives; what was read stays where it lives.
    """

    tool: str
    arguments: dict[str, Any]
    rows: int
    error: str = ""


@dataclass(frozen=True)
class ProposedAction:
    """What the model would do about the answer, for a person to decide on.

    **Reported, never performed.** Nothing in this runtime can perform one: an action carries no
    Postgres function, and the only thing that turns this into a write is somebody in `apps/web`
    pressing a button, at which point the domain layer does it under their own session (D34).
    """

    name: str
    arguments: dict[str, Any]
    because: str


@dataclass(frozen=True)
class Answer:
    """What to write down, and what to show the person.

    `outcome` is platform vocabulary in the way `automation_runs.outcome` is: three words about
    what this platform did, none of which a business has an opinion about.

      * `answered`   -- there are words to show.
      * `unanswered` -- the loop finished with nothing to say. Not a failure: it is the evidence
                        that decides whether retrieval is worth building, so it is recorded
                        distinctly rather than folded into either neighbour.
      * `failed`     -- the provider was unreachable, unconfigured or refused.
    """

    outcome: str
    text: str = ""
    detail: str = ""
    tools: list[ToolRecord] = field(default_factory=list)
    action: ProposedAction | None = None


def _run_tool(
    settings: AssistantSettings, *, token: str, call: ToolCall, tool: Tool
) -> tuple[ToolResult, ToolRecord]:
    try:
        rows = call_tool(
            settings, token=token, function=tool.function, arguments=call.arguments
        )
    except ToolFailed as refusal:
        # The database's own words, back to the model and onto the record. A model that asked
        # for something the caller may not see can say so, which is a better answer than a
        # failed run and a blank screen.
        return (
            ToolResult(call=call, error=str(refusal)),
            ToolRecord(tool=call.name, arguments=call.arguments, rows=0, error=str(refusal)),
        )

    return (
        ToolResult(call=call, rows=rows),
        ToolRecord(tool=call.name, arguments=call.arguments, rows=len(rows)),
    )


def answer(
    settings: AssistantSettings,
    provider: AnsweringProvider,
    *,
    question: str,
    token: str,
) -> Answer:
    """Run the loop until the provider stops asking for tools, or the cap is reached."""
    history: list[Exchange] = []
    performed: list[ToolRecord] = []

    for _ in range(MAX_TURNS):
        try:
            turn = provider.next_turn(
                # Actions are declared beside the tools because that is how a model is given a
                # way to say what it would do. What separates them is entirely on this side:
                # a name in `TOOLS` resolves to a function and runs; a name in `ACTIONS`
                # resolves to nothing and stops the loop.
                question=question,
                tools=TOOLS + ACTIONS,
                history=tuple(history),
            )
        except Exception as failure:  # noqa: BLE001 - the provider's own words, recorded
            return Answer(outcome="failed", detail=str(failure), tools=performed)

        # **An action ends the turn, and it ends it here rather than after the tools run.** A
        # model that asks to read something *and* proposes a move in one breath has proposed it
        # without having read; stopping first means the proposal is always made on what it
        # already knows.
        proposal = next(
            (call for call in turn.calls if action_named(call.name) is not None), None
        )
        if proposal is not None:
            because = str(proposal.arguments.get("because") or "")
            return Answer(
                outcome="answered" if (turn.text.strip() or because) else "unanswered",
                text=turn.text.strip() or because,
                tools=performed,
                action=ProposedAction(
                    name=proposal.name, arguments=proposal.arguments, because=because
                ),
            )

        if not turn.calls:
            if turn.text.strip():
                return Answer(outcome="answered", text=turn.text.strip(), tools=performed)
            return Answer(outcome="unanswered", tools=performed)

        results: list[ToolResult] = []
        for call in turn.calls:
            tool = tool_named(call.name)
            if tool is None:
                # A name nothing matches. Handed back rather than raised: the model chose a
                # word, and being told the word is wrong is how it chooses another.
                results.append(ToolResult(call=call, error="no tool by that name"))
                performed.append(
                    ToolRecord(
                        tool=call.name,
                        arguments=call.arguments,
                        rows=0,
                        error="no tool by that name",
                    )
                )
                continue

            result, record = _run_tool(settings, token=token, call=call, tool=tool)
            results.append(result)
            performed.append(record)

        history.append(Exchange(turn=turn, results=tuple(results)))

    # The cap. Recorded as unanswered rather than failed, because nothing broke: the loop went
    # round six times and produced nothing worth showing, which is a fact about the question.
    return Answer(outcome="unanswered", tools=performed)
