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

from app.ai import (
    AnswerFailed,
    AnsweringProvider,
    AttachedText,
    Exchange,
    ModelUsage,
    PriorTurn,
    Tool,
    ToolCall,
    ToolResult,
    Turn,
)
from app.ai.actions import ACTIONS, action_named
from app.ai.tools import TOOLS, tool_named
from app.core.caller import ToolFailed, call_tool
from app.core.config import AssistantSettings

# **A cap rather than a budget.** Every tool here answers in one call, so a question needing
# more than a handful of turns is a model going in circles rather than a hard question -- and an
# uncapped loop against a metered provider is a bill nobody agreed to.
MAX_TURNS = 6

# **What an earlier part of the same conversation may cost.** Bounded here as well as by
# `apps/web`, which builds it: this runtime cannot assume its caller was careful, and a request
# that grew without limit is a bill that grew without limit. The numbers are
# `lib/domain/assistant/questions.ts`'s, restated because the two runtimes share no code.
MAX_PRIOR_TURNS = 10
MAX_PRIOR_ANSWER_CHARS = 3_000
MAX_PRIOR_CHARS = 12_000


# **Files sent with a question**, bounded here for the same reason. `apps/web` has already read
# them as text and cut them; this is the second line, and the one that holds if the first is bypassed.
MAX_ATTACHMENTS = 3
MAX_ATTACHMENT_CHARS = 20_000
MAX_ATTACHMENTS_CHARS = 40_000
MAX_ATTACHMENT_NAME = 120


def bound_attachments(files: tuple[AttachedText, ...]) -> tuple[AttachedText, ...]:
    """At most a few files, each shortened, and all of them within one budget."""
    kept: list[AttachedText] = []
    remaining = MAX_ATTACHMENTS_CHARS
    for file in files[:MAX_ATTACHMENTS]:
        allowed = max(0, min(MAX_ATTACHMENT_CHARS, remaining))
        text = file.text[:allowed]
        remaining -= len(text)
        kept.append(
            AttachedText(
                # A name is quoted into a prompt, so it carries nothing but its own characters.
                name="".join(c for c in file.name if c.isprintable() and c not in '"<>')[:MAX_ATTACHMENT_NAME],
                mime_type=file.mime_type[:80],
                text=text,
                truncated=file.truncated or len(text) < len(file.text),
            )
        )
    return tuple(kept)


def render_attachments(files: tuple[AttachedText, ...]) -> str:
    """The files as quoted material, for a provider to place after the question.

    Each is fenced in an `<attachment>` element so a model can tell what the person typed from what
    they handed over, and a closing tag inside a file cannot end the fence early.
    """
    parts = []
    for file in files:
        body = file.text.replace("</attachment", "<\\/attachment")
        note = " (shortened)" if file.truncated else ""
        parts.append(f'<attachment name="{file.name}" type="{file.mime_type}"{note}>\n{body}\n</attachment>')
    return "\n\n".join(parts)


def bound_prior_turns(turns: tuple[PriorTurn, ...]) -> tuple[PriorTurn, ...]:
    """The most recent turns that fit, oldest first.

    Walks from the newest backwards and stops at the first that does not fit, so what is kept is
    always an unbroken run ending at the latest exchange -- a gap in the middle of a conversation
    would be a model answering a question that refers to something it was never shown.
    """
    kept: list[PriorTurn] = []
    used = 0
    for turn in reversed(turns[-MAX_PRIOR_TURNS:]):
        answer_text = turn.answer
        if len(answer_text) > MAX_PRIOR_ANSWER_CHARS:
            answer_text = answer_text[: MAX_PRIOR_ANSWER_CHARS - 1] + "…"
        cost = len(turn.question) + len(answer_text)
        if used + cost > MAX_PRIOR_CHARS:
            break
        used += cost
        kept.append(PriorTurn(question=turn.question, answer=answer_text))
    return tuple(reversed(kept))


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
    # **What every model call this request made consumed, summed once.** The loop adds each call's
    # own report as it arrives, so a request that asked three times carries three calls' worth and
    # no call is counted twice. `None` when no call reported anything; and a call that could not
    # report is counted in `calls_without_usage` rather than being added as zero.
    usage: ModelUsage | None = None
    calls_without_usage: int = 0


def _run_tool(
    settings: AssistantSettings,
    *,
    token: str,
    organization_id: str,
    call: ToolCall,
    tool: Tool,
) -> tuple[ToolResult, ToolRecord]:
    # **Which business is filled in here and is not the model's to choose.** It appears in no
    # schema and no prompt, so there is nothing for a model to get wrong or to be talked into --
    # and it is written *after* whatever the model sent, so a model that supplies one anyway is
    # overridden rather than obeyed. RLS decides what any of it can see regardless (D34); this is
    # what keeps the tool from being handed an id nobody ever told it.
    # **Only what the schema offered, and a business the model was never asked for.**
    #
    # Two filters, both written from watching a real model. A weaker one invented a `status`
    # argument on a tool whose schema declares no properties at all, and PostgREST answered
    # *could not find the function* -- a hard failure where the right behaviour was to ignore a
    # word nobody offered and answer the question. The schema is the contract: anything outside
    # it was never on the table, so it is dropped rather than forwarded.
    #
    # And a model naming a business is dropped rather than merged past, so exactly one key says
    # which one. Merging alone was not enough -- `organization_id` and `p_organization_id` are
    # different keys, so both landed in the record and it read as though two were sent.
    offered = set(tool.schema.get("properties", {}))
    supplied = {
        key: value
        for key, value in call.arguments.items()
        if key in offered and key not in ("organization_id", "p_organization_id")
    }
    arguments = {**supplied, "p_organization_id": organization_id}
    try:
        rows = call_tool(
            settings, token=token, function=tool.function, arguments=arguments
        )
    except ToolFailed as refusal:
        # The database's own words, back to the model and onto the record. A model that asked
        # for something the caller may not see can say so, which is a better answer than a
        # failed run and a blank screen.
        return (
            ToolResult(call=call, error=str(refusal)),
            ToolRecord(tool=call.name, arguments=arguments, rows=0, error=str(refusal)),
        )

    return (
        ToolResult(call=call, rows=rows),
        # **What was sent, not what was asked for**, and the difference is visible the moment a
        # model supplies an organization id of its own: recording the one it invented would put
        # a business id in the record that had no bearing on the answer, which is a record that
        # misleads whoever reads it a year later.
        ToolRecord(tool=call.name, arguments=arguments, rows=len(rows)),
    )


def answer(
    settings: AssistantSettings,
    provider: AnsweringProvider,
    *,
    question: str,
    token: str,
    organization_id: str,
    context: str = "",
    prior_turns: tuple[PriorTurn, ...] = (),
    attachments: tuple[AttachedText, ...] = (),
    tools: tuple[Tool, ...] = TOOLS,
    actions: tuple[Tool, ...] = ACTIONS,
    audience: str = "operator",
    instructions: str = "",
) -> Answer:
    """Run the loop until the provider stops asking for tools, or the cap is reached.

    `context` is what the application knows and a model cannot: today's date, in the business's
    own zone. Written from watching one propose a move to *9am tomorrow* and produce a date in
    2024 — a model has no clock, and *tomorrow* is the most ordinary word an operator will use.
    It is application state rather than anything a tenant said, which is the line that decides
    what this platform may put into a prompt at all.

    `instructions` is the opposite case, and is kept out of `context` for that reason: it is what a
    *tenant* wrote about how their assistant should behave. It reaches the model as its own quoted
    section beneath the platform's rules (`app.ai.prompts`), where a model can tell it from the rules
    and from the application's facts.
    """
    prior_turns = bound_prior_turns(prior_turns)
    attachments = bound_attachments(attachments)
    history: list[Exchange] = []
    performed: list[ToolRecord] = []
    total: ModelUsage | None = None
    unreported = 0

    def consumed(usage: ModelUsage | None) -> None:
        nonlocal total, unreported
        if usage is None:
            unreported += 1
        else:
            total = usage if total is None else total + usage

    def finish(**fields: Any) -> Answer:
        return Answer(usage=total, calls_without_usage=unreported, tools=performed, **fields)

    for _ in range(MAX_TURNS):
        try:
            turn = provider.next_turn(
                # Actions are declared beside the tools because that is how a model is given a
                # way to say what it would do. What separates them is entirely on this side:
                # a name in `TOOLS` resolves to a function and runs; a name in `ACTIONS`
                # resolves to nothing and stops the loop.
                question=question,
                tools=tools + actions,
                history=tuple(history),
                context=context,
                prior_turns=prior_turns,
                attachments=attachments,
                audience=audience,
                instructions=instructions,
            )
        except Exception as failure:  # noqa: BLE001 - the provider's own words, recorded
            # A provider that answered and could not be used (a refusal) says what it consumed;
            # one that never answered has nothing to report, and is not charged for.
            if isinstance(failure, AnswerFailed):
                consumed(failure.usage)
            return finish(outcome="failed", detail=str(failure))

        consumed(turn.usage)

        # **An action ends the turn, and it ends it here rather than after the tools run.** A
        # model that asks to read something *and* proposes a move in one breath has proposed it
        # without having read; stopping first means the proposal is always made on what it
        # already knows.
        proposal = next(
            (call for call in turn.calls if any(action.name == call.name for action in actions)), None
        )
        if proposal is not None:
            because = str(proposal.arguments.get("because") or "")
            return finish(
                outcome="answered" if (turn.text.strip() or because) else "unanswered",
                text=turn.text.strip() or because,
                action=ProposedAction(
                    name=proposal.name, arguments=proposal.arguments, because=because
                ),
            )

        if not turn.calls:
            if turn.text.strip():
                return finish(outcome="answered", text=turn.text.strip())
            return finish(outcome="unanswered")

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

            result, record = _run_tool(
                settings,
                token=token,
                organization_id=organization_id,
                call=call,
                tool=tool,
            )
            results.append(result)
            performed.append(record)

        history.append(Exchange(turn=turn, results=tuple(results)))

    # The cap. Recorded as unanswered rather than failed, because nothing broke: the loop went
    # round six times and produced nothing worth showing, which is a fact about the question.
    return finish(outcome="unanswered")
