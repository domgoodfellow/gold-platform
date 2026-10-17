"""Answering a question about a business, named as a capability rather than as a provider.

The third capability contract in this runtime, beside `app.channels` and `app.conditions`, and
it holds the same line for the same reason: everything above this file asks for *the next
turn of a conversation*, and exactly one module per provider knows who is being asked.

**The loop is not in here, and that is the load-bearing part.** `app.ai.loop` owns iteration,
tool dispatch, the cap and the record; a provider answers one question and stops. The tempting
alternative is to build on a vendor SDK's own tool-running helper, which is genuinely less code
-- and it puts the loop inside one vendor's convenience wrapper, so the day a business runs a
local model there are two loops, two dispatch paths, and an `agent_runs` row that means
different things depending on who answered. The AI-tool architecture (ADR-018) records that decision.

**What a capability may not leak.** No type here carries a model name, a finish reason, a role
string or a vendor's identifier for a tool call. The one number it does carry is `ModelUsage`:
what a provider says a call consumed, in the only two quantities GildOps meters, because the
provider is the only party that knows it. A turn goes in as a transcript
and comes back as text or as calls to make. `answered_by` is written onto the run row from the
registry's own `name`, which is a word for somebody reading the record a year later and is not
something any code branches on -- the same standing `drafted_by` has on a configuration
proposal.

**A tool is described here and defined in Postgres.** What this module holds is a name, a
sentence and a JSON schema; what runs is `public.work_at_risk` and the tools after it, `stable`
and `security invoker`, under the caller's own token. Nothing in this package writes SQL, and
nothing in it does arithmetic on an answer -- both of those are how a second domain layer starts
.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ToolCall:
    """One call a provider wants made, in this platform's words rather than a vendor's.

    `reference` is whatever the provider needs handed back to it to match the result to the
    request -- an id for one, a position for another. It is opaque above the adapter and is
    never read, compared or logged by anything but the provider that issued it.
    """

    name: str
    arguments: dict[str, Any]
    reference: str


@dataclass(frozen=True)
class Turn:
    """What the provider did with the transcript it was given.

    Exactly one of these is populated in practice, and both being empty is a real answer: it
    means the provider produced nothing usable, which is recorded as `unanswered` rather than as
    a failure. That distinction is slice four's evidence -- a question a query could not answer
    is the argument for retrieval, and a question nothing answered because the model wandered is
    not.
    """

    text: str = ""
    calls: tuple[ToolCall, ...] = ()
    # What this one call consumed, as the provider reported it. `None` is *the provider did not
    # say*, which is not the same fact as zero and is never turned into it: a provider that cannot
    # report is a gap in the record, and recording a zero would make it a claim.
    usage: "ModelUsage | None" = None


@dataclass(frozen=True)
class ModelUsage:
    """What a provider reported one model call consumed.

    Taken from the provider's own response, never estimated from the length of a string and never
    tokenised locally. `input_tokens` is everything the model read, cached or not; `output_tokens`
    is everything it produced, including whatever it spent reasoning -- the two quantities the
    `ai_tokens_input` and `ai_tokens_output` meters count.
    """

    input_tokens: int
    output_tokens: int

    def __add__(self, other: "ModelUsage") -> "ModelUsage":
        return ModelUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
        )


class AnswerFailed(RuntimeError):
    """A provider that answered, and whose answer cannot be used -- a refusal, a truncation.

    Carries what the call consumed, because a refusal is still a call somebody paid for and the
    loop would otherwise lose it with the exception. A provider that failed *before* an answer
    (unreachable, unconfigured) raises something else and has consumed nothing to report.
    """

    def __init__(self, message: str, usage: ModelUsage | None = None) -> None:
        super().__init__(message)
        self.usage = usage


@dataclass(frozen=True)
class ToolResult:
    """What a tool returned, on its way back into the transcript.

    `rows` is exactly what Postgres answered under the caller's own token. Nothing here filters
    it, sorts it or trims it: this runtime did not decide what the caller may see and must not
    look as though it did.
    """

    call: ToolCall
    rows: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""


@dataclass(frozen=True)
class Exchange:
    """One turn and what came back from it.

    **The whole history is passed to a provider every time, as pairs.** The first draft of this
    contract passed the turns and the most recent results separately, which cannot be rebuilt
    into a conversation: a model needs each result attached to the call it answers, and after two
    rounds there was no way to say which was which. Pairing them here means the loop holds the
    history and no adapter has to remember anything.
    """

    turn: Turn
    results: tuple[ToolResult, ...] = ()


@dataclass(frozen=True)
class PriorTurn:
    """One earlier question in the same conversation, and the words that answered it.

    **Text only, and only what was finished.** No tool call and no row a tool returned: a result
    was readable to somebody at the moment it came back, and carrying it into a later request
    would be a second copy of tenant data travelling somewhere its own policies do not follow. What
    the model said about those rows is what a person read, and is all a follow-up needs.
    """

    question: str
    answer: str


@dataclass(frozen=True)
class AttachedText:
    """A file the person sent with *this* question, already read as text.

    **Text only, by construction.** `apps/web` reads the file under the asker's own token and
    refuses anything that is not UTF-8 text, so what reaches a provider is a name and words -- never
    bytes. It is data the person handed over, not something to obey: a provider must render it as
    quoted material (see `app.ai.loop.render_attachments`), and it is not carried into later turns.
    """

    name: str
    mime_type: str
    text: str
    truncated: bool = False


@dataclass(frozen=True)
class Tool:
    """A tool as a provider is told about it.

    `function` is the Postgres function this resolves to, and the only place the two are tied
    together. `ai-tools.test.ts` reads this list and asserts each one exists, is not `volatile`,
    and runs as its invoker -- so a tool that could write, or one that would run as its owner
    and see every tenant, fails the gate.
    """

    name: str
    description: str
    schema: dict[str, Any]
    function: str


# Who a conversation is with, which is what decides the platform's own rules for the model. Three
# words about the platform's side of it, in the way `Answer.outcome` is: a business has no opinion
# about them. `app.ai.prompts` is the only place that turns one into words.
AUDIENCES = ("operator", "public", "drafting")


class AnsweringProvider(Protocol):
    """One model's implementation."""

    @property
    def name(self) -> str:
        """For a message an operator reads, and for nothing that decides anything."""

    @property
    def provider_key(self) -> str:
        """Which `platform_providers` row answers, so the usage it reports is attributed to it.

        A key and not a branch: nothing above an adapter decides anything from it.
        """

    def next_turn(
        self,
        *,
        question: str,
        tools: tuple[Tool, ...],
        history: tuple["Exchange", ...],
        context: str = "",
        prior_turns: tuple["PriorTurn", ...] = (),
        attachments: tuple["AttachedText", ...] = (),
        audience: str = "operator",
        instructions: str = "",
    ) -> Turn:
        """The next turn, given everything that has happened so far.

        **Stateless on purpose.** The whole transcript is passed every time rather than held
        inside an adapter, so the loop can be read in one place and a provider cannot quietly
        become the thing that remembers. It is also what lets the milestone test drive a fixed
        provider through this same seam rather than around it.

        `context` is what the application knows and the model cannot — today's date in the
        business's own zone. It is deliberately separate from the question rather than glued to
        the front of it: the question is what somebody typed and is recorded as such, and an
        implementation that caches a stable prompt prefix needs to know which half is which.

        `prior_turns` are the earlier questions and answers of the *same* conversation, oldest
        first, already bounded by `app.ai.loop`. They precede `question` in the transcript; a
        provider renders them as it renders any earlier exchange and decides nothing about them.

        `attachments` are the files sent with `question` itself, as bounded text. A provider puts
        them in the same user message as the question, quoted, and never treats them as
        instructions.

        `audience` selects the platform's own rules (`app.ai.prompts.system_prompt`). `instructions`
        is what the *business* wrote about how its assistant should behave -- a third thing, neither
        the platform's rules nor application state, and rendered by `app.ai.prompts.render_instructions`
        as quoted material below the rules rather than into `context`.

        Raises on a provider that is unreachable, unconfigured or failing. An empty `Turn` is
        the other answer: the provider worked and produced nothing to act on.
        """
