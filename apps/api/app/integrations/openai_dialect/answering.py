"""Anything that speaks chat completions, which is how a local model gets here.

**Named for the dialect rather than for a vendor, because that is what it is.** Ollama, vLLM,
text-generation-inference and Hugging Face's hosted inference all answer the same
`/chat/completions` shape, so one implementation serves a model on somebody's own hardware and a
hosted endpoint alike -- the difference between them is a header and a base URL, and neither is
a reason for two files.

**This is the answer to "must our rows leave the building".** A deployment that sets
`ASSISTANT_BASE_URL` to a model it runs sends nothing to anybody, and nothing above this file
changes. That is the whole argument for the provider seam existing in the first slice rather
than being retrofitted the first time somebody asks (D34).

**No SDK, and here that is the ordinary choice rather than an exception.** Two POSTs to a JSON
endpoint, in a runtime whose dependency list is deliberately one line long. Which vendor's client
library would it even be?

**A word of warning that belongs in the code.** Tool-calling below the frontier models is
uneven: some emit a call with the arguments as a JSON string, some emit no call at all, some
invent a tool name. Every one of those is handled here as an ordinary answer rather than an
error, and the loop's cap is what stops a model that has lost the thread. What a business sees
when that happens is a run recorded as unanswered with `answered_by` naming the model -- which is
the honest outcome, and the reason that column exists.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.ai import Exchange, Tool, ToolCall, Turn

MAX_TOKENS = 8_000

SYSTEM = (
    "You answer questions about one business's operations for somebody who works there.\n\n"
    "Use the tools to find out what is true. Never state a number, a name or a date that did "
    "not come back from a tool in this conversation, and never estimate one.\n\n"
    "If the tools cannot answer the question, say plainly that you cannot answer it and what "
    "you would have needed. Do not apologise and do not offer to do something else."
)


def _arguments(raw: Any) -> dict[str, Any]:
    """Whatever the model put in `arguments`, as a dictionary or as nothing.

    A string of JSON is what the dialect specifies; an object is what several servers send
    anyway; a truncated string is what a small model sends when it runs out of room. All three
    arrive here and none of them is worth failing a run over -- an empty dictionary reaches the
    function, Postgres refuses it, and the refusal goes back as a tool result the model can read.
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


def dialect_provider(*, base_url: str, model: str, api_key: str | None, name: str):
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    class Provider:
        def __init__(self) -> None:
            self.name = name

        def next_turn(
            self, *, question: str, tools: tuple[Tool, ...], history: tuple[Exchange, ...]
        ) -> Turn:
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": question},
            ]

            for exchange in history:
                assistant: dict[str, Any] = {
                    "role": "assistant",
                    "content": exchange.turn.text or None,
                }
                if exchange.turn.calls:
                    assistant["tool_calls"] = [
                        {
                            "id": call.reference,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments),
                            },
                        }
                        for call in exchange.turn.calls
                    ]
                messages.append(assistant)

                # One message per result here, unlike the block-shaped dialect. Not a choice:
                # it is what this shape specifies.
                for result in exchange.results:
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": result.call.reference,
                            "content": result.error or json.dumps(result.rows, default=str),
                        }
                    )

            response = httpx.post(
                endpoint,
                headers=headers,
                json={
                    "model": model,
                    "max_tokens": MAX_TOKENS,
                    "messages": messages,
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": tool.name,
                                "description": tool.description,
                                "parameters": tool.schema,
                            },
                        }
                        for tool in tools
                    ],
                },
                # Generous, because a model on modest hardware is slow rather than broken.
                timeout=120.0,
            )

            if response.status_code >= 400:
                raise RuntimeError(f"{name} refused the request ({response.status_code})")

            choices = response.json().get("choices") or []
            if not choices:
                return Turn()

            message = choices[0].get("message") or {}
            calls = tuple(
                ToolCall(
                    name=(call.get("function") or {}).get("name", ""),
                    arguments=_arguments((call.get("function") or {}).get("arguments")),
                    reference=call.get("id") or f"call-{index}",
                )
                for index, call in enumerate(message.get("tool_calls") or [])
            )

            return Turn(text=message.get("content") or "", calls=calls)

    return Provider()
