"""OpenAI, as one implementation of `AnsweringProvider`.

**The second vendor SDK in `apps/api`, for the reason the first one is** (see
`app.providers.anthropic.answering`): the Responses API's typed output items -- function calls,
refusals, incomplete generations -- are what an SDK is for, and hand-parsing them would mean
maintaining a parser for somebody else's response shape. The chat-completions dialect beside this
one needs no library at all, because that wire format is a plain JSON dict either way.

**The loop is not here, for the same reason D34 gives everywhere else in this package.** This
module answers one question and stops; `app.ai.loop` owns iteration.

**Stateless by construction, deliberately not using `previous_response_id`.** The Responses API
can hold conversation state server-side, keyed by a response id this runtime would then have to
store somewhere and treat as sensitive. `AnsweringProvider.next_turn` already receives the whole
transcript every call (D34's contract), so this adapter rebuilds `input` from it in full instead
-- one fewer thing to store, and the same shape every other adapter already has.
"""

from __future__ import annotations

import json
from typing import Any

import openai

from app.ai import AnswerFailed, AttachedText, Exchange, ModelUsage, PriorTurn, Tool, ToolCall, Turn
from app.ai.loop import render_attachments
from app.ai.prompts import render_instructions, system_prompt

MAX_OUTPUT_TOKENS = 8_000
# A whole proposed configuration is one answer (see the Anthropic adapter).
DRAFTING_MAX_OUTPUT_TOKENS = 16_000

def _usage(response: Any) -> ModelUsage | None:
    """What the response says it consumed, or `None` when it does not say.

    `output_tokens` already includes whatever the model spent reasoning, which is billed as output.
    """
    usage = getattr(response, "usage", None)
    read = getattr(usage, "input_tokens", None)
    wrote = getattr(usage, "output_tokens", None)
    if not isinstance(read, int) or not isinstance(wrote, int):
        return None
    return ModelUsage(input_tokens=read, output_tokens=wrote)


def _arguments(raw: Any) -> dict[str, Any]:
    """A function call's `arguments`, which the Responses API sends as a JSON string.

    Parsed defensively rather than trusted: a truncated or malformed string is handled as an
    ordinary answer (an empty dict reaches the tool, Postgres refuses it, the refusal goes back
    as a tool result), not a reason to fail the run.
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def openai_provider(*, api_key: str, model: str):
    client = openai.OpenAI(api_key=api_key)

    class Provider:
        name = model
        provider_key = "openai"

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
            items: list[dict[str, Any]] = []
            for prior in prior_turns:
                items.append({"role": "user", "content": prior.question})
                items.append({"role": "assistant", "content": prior.answer})

            items.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": question},
                        *(
                            [{"type": "input_text", "text": render_attachments(attachments)}]
                            if attachments
                            else []
                        ),
                    ],
                }
            )

            for exchange in history:
                if exchange.turn.text.strip():
                    items.append({"role": "assistant", "content": exchange.turn.text})
                for call in exchange.turn.calls:
                    items.append(
                        {
                            "type": "function_call",
                            "call_id": call.reference,
                            "name": call.name,
                            "arguments": json.dumps(call.arguments),
                        }
                    )
                # One result per item, matched by `call_id` rather than batched -- the shape the
                # Responses API specifies, the same way the chat-completions dialect specifies one
                # `tool` message per result rather than Anthropic's single batched one.
                for result in exchange.results:
                    items.append(
                        {
                            "type": "function_call_output",
                            "call_id": result.call.reference,
                            "output": result.error or json.dumps(result.rows, default=str),
                        }
                    )

            # The rules, then what the business wrote, then what the application knows -- each its
            # own paragraph rather than glued to the question, so what somebody typed stays what
            # they typed.
            system = "\n\n".join(
                part for part in (system_prompt(audience), render_instructions(instructions), context) if part
            )

            response = client.responses.create(
                model=model,
                instructions=system,
                input=items,
                max_output_tokens=DRAFTING_MAX_OUTPUT_TOKENS if audience == "drafting" else MAX_OUTPUT_TOKENS,
                tools=[
                    {
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.schema,
                    }
                    for tool in tools
                ],
            )

            if response.status == "failed":
                detail = getattr(response.error, "message", None) if response.error else None
                raise AnswerFailed(detail or "the model failed to answer", _usage(response))
            if response.status == "incomplete":
                reason = getattr(response.incomplete_details, "reason", None)
                raise AnswerFailed(
                    f"the model stopped before finishing: {reason or 'unknown reason'}", _usage(response)
                )

            refusal = next(
                (item.refusal for item in response.output if item.type == "refusal"), None
            )
            if refusal:
                raise AnswerFailed(refusal, _usage(response))

            calls = tuple(
                ToolCall(
                    name=item.name,
                    arguments=_arguments(item.arguments),
                    reference=item.call_id,
                )
                for item in response.output
                if item.type == "function_call"
            )

            return Turn(text=response.output_text or "", calls=calls, usage=_usage(response))

    return Provider()
