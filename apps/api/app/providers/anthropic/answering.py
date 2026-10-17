"""Claude, as one implementation of `AnsweringProvider`.

The default, and the only place in this runtime that names it. Everything above sees a
transcript going in and a turn coming out.

**Model is runtime configuration, not a constant here.** `app.ai.registry` supplies a fallback
model for the unassigned/legacy-environment path; `app.ai.runtime` supplies whatever a runtime
assignment names. Neither this module nor any other adapter hardcodes one -- a model changes far
more often than the provider it belongs to.

**The first vendor SDK in `apps/api`, and that is a deliberate exception rather than a drift.**
Stripe is hand-rolled here because the whole integration is an HMAC and one HTTP call, and the
SDK would have been more surface than substance. This is not that: content blocks, tool calls,
thinking, typed errors and retries are exactly what an SDK is for, and hand-rolling them would
mean maintaining a parser for somebody else's response shape.

**The loop is not here.** The SDK offers a tool runner that would drive the whole exchange, and
taking it would put iteration inside one vendor's helper -- so a deployment running a local model
would need a second loop, and `agent_runs` would mean two different things. See `app.ai.loop`,
and the AI-tool architecture.
"""

from __future__ import annotations

import json
from typing import Any

import anthropic

from app.ai import AnswerFailed, AttachedText, Exchange, ModelUsage, PriorTurn, Tool, ToolCall, Turn
from app.ai.loop import render_attachments
from app.ai.prompts import render_instructions, system_prompt

# Enough for an answer about a day's work with room to spare, and small enough to stay well
# inside the SDK's own request timeout without streaming. Streaming is a second thing that can
# fail between two deployments, and nothing on the screen yet consumes a partial answer.
MAX_TOKENS = 8_000
# A whole proposed configuration is one answer, and adaptive thinking spends from the same budget.
DRAFTING_MAX_TOKENS = 16_000

def _usage(response: Any) -> ModelUsage | None:
    """What the response says it consumed, or `None` when it does not say.

    Cached reads and cache writes are input the model read, so they count toward the input meter
    beside the uncached remainder; leaving them out would under-report exactly the requests the
    cache was built for. Thinking is part of `output_tokens`.
    """
    usage = getattr(response, "usage", None)
    read = getattr(usage, "input_tokens", None)
    wrote = getattr(usage, "output_tokens", None)
    if not isinstance(read, int) or not isinstance(wrote, int):
        return None
    cached = 0
    for field in ("cache_creation_input_tokens", "cache_read_input_tokens"):
        value = getattr(usage, field, None)
        cached += value if isinstance(value, int) else 0
    return ModelUsage(input_tokens=read + cached, output_tokens=wrote)


def _content(exchange: Exchange) -> list[dict[str, Any]]:
    """One assistant turn, rebuilt as the blocks it was."""
    blocks: list[dict[str, Any]] = []
    if exchange.turn.text.strip():
        blocks.append({"type": "text", "text": exchange.turn.text})
    for call in exchange.turn.calls:
        blocks.append(
            {
                "type": "tool_use",
                "id": call.reference,
                "name": call.name,
                "input": call.arguments,
            }
        )
    return blocks


def anthropic_provider(*, api_key: str, model: str):
    client = anthropic.Anthropic(api_key=api_key)

    class Provider:
        name = model
        provider_key = "anthropic"

        def next_turn(
            self,
            *,
            question: str,
            tools: tuple[Tool, ...],
            history: tuple[Exchange, ...],
            context: str = "",
            prior_turns: tuple[PriorTurn, ...] = (),
            attachments: tuple[AttachedText, ...] = (),
            audience: str = "operator",
            instructions: str = "",
        ) -> Turn:
            # Earlier turns of this conversation first, as the plain words each side said.
            messages: list[dict[str, Any]] = []
            for prior in prior_turns:
                messages.append({"role": "user", "content": prior.question})
                messages.append({"role": "assistant", "content": prior.answer})
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        *(
                            [{"type": "text", "text": render_attachments(attachments)}]
                            if attachments
                            else []
                        ),
                    ],
                }
            )

            for exchange in history:
                messages.append({"role": "assistant", "content": _content(exchange)})
                # **Every result in one user message.** Splitting them across several teaches
                # the model to stop asking for more than one thing at a time, which makes every
                # later answer slower for no gain.
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": result.call.reference,
                                "content": result.error
                                or json.dumps(result.rows, default=str),
                                "is_error": bool(result.error),
                            }
                            for result in exchange.results
                        ],
                    }
                )

            response = client.messages.create(
                model=model,
                max_tokens=DRAFTING_MAX_TOKENS if audience == "drafting" else MAX_TOKENS,
                thinking={"type": "adaptive"},
                # The tools and the system prompt are byte-identical on every turn of every
                # conversation, and they render ahead of the messages -- so one breakpoint here
                # caches the stable half and the question stays outside it.
                system=[
                    {
                        "type": "text",
                        "text": system_prompt(audience),
                        "cache_control": {"type": "ephemeral"},
                    },
                    # What the business wrote, after the rules and outside the cached block: it
                    # is theirs and differs per deployment, and it is not application state.
                    *(
                        [{"type": "text", "text": render_instructions(instructions)}]
                        if instructions.strip()
                        else []
                    ),
                    # **After the breakpoint, deliberately.** Today's date changes daily and the
                    # prompt above does not; putting it inside the cached block would throw the
                    # cache away every midnight for one sentence.
                    *([{"type": "text", "text": context}] if context else []),
                ],
                tools=[
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.schema,
                    }
                    for tool in tools
                ],
                messages=messages,
            )

            if response.stop_reason == "refusal":
                # The model declined. A refusal is not an outage and not an empty answer, so it
                # is raised with its own words and recorded as a failure the person can read.
                detail = getattr(response.stop_details, "explanation", None)
                raise AnswerFailed(detail or "the model declined to answer this", _usage(response))

            # A tool call cut off at the token limit is half an argument that parses as a complete
            # one -- the worse failure, because what arrived looks finished. Refused, not acted on.
            if response.stop_reason == "max_tokens" and any(
                block.type == "tool_use" for block in response.content
            ):
                raise AnswerFailed("the answer was cut off before it finished", _usage(response))

            text = "".join(
                block.text for block in response.content if block.type == "text"
            )
            calls = tuple(
                ToolCall(
                    name=block.name,
                    # Already parsed by the SDK. Never string-matched: escaping in tool input
                    # differs between models and only the parsed object is reliable.
                    arguments=dict(block.input) if isinstance(block.input, dict) else {},
                    reference=block.id,
                )
                for block in response.content
                if block.type == "tool_use"
            )

            return Turn(text=text, calls=calls, usage=_usage(response))

    return Provider()
