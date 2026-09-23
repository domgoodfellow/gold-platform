"""Which implementation answers for a `(provider_key, provider_service_key)` pair.

**The only place a Provider Service's key is turned into a running `AnsweringProvider`.**
`app.ai.runtime` asks for the adapter behind a resolved runtime assignment and never imports a
vendor module directly (I15, mirroring `app.providers.providers.operations_for`). A service with
no entry here has no answering implementation, however the catalogue describes it -- credential
configured is not the same fact as service implemented, and `record_ai_runtime_assignment` refuses
an assignment to a service the catalogue itself has not marked `available` for exactly that reason.

Each factory takes `api_key` and `model` as runtime configuration; nothing here reads an
environment variable or a database row itself.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.ai import AnsweringProvider

AdapterFactory = Callable[..., "AnsweringProvider"]


def _anthropic_messages(*, api_key: str, model: str) -> "AnsweringProvider":
    from app.providers.anthropic.answering import anthropic_provider

    return anthropic_provider(api_key=api_key, model=model)


def _openai_responses(*, api_key: str, model: str) -> "AnsweringProvider":
    from app.providers.openai.answering import openai_provider

    return openai_provider(api_key=api_key, model=model)


def _google_gemini_interactions(*, api_key: str, model: str) -> "AnsweringProvider":
    from app.providers.google.answering import gemini_provider

    return gemini_provider(api_key=api_key, model=model)


ADAPTERS: dict[tuple[str, str], AdapterFactory] = {
    ("anthropic", "messages"): _anthropic_messages,
    ("openai", "responses"): _openai_responses,
    ("google", "gemini_interactions"): _google_gemini_interactions,
}


def adapter_for(provider_key: str, provider_service_key: str) -> AdapterFactory | None:
    return ADAPTERS.get((provider_key, provider_service_key))
