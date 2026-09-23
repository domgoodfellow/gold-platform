"""Which vendor module answers for a provider key.

**The one place a provider key is turned into an implementation.** `app.domains.providers` asks
for the operations of `provider_key` and never imports a vendor (I15). A provider with no entry
here has no operations, and a request for it is refused rather than guessed at.
"""

from __future__ import annotations

from collections.abc import Callable

Operation = Callable[[dict, dict], dict]


class UpstreamRefused(RuntimeError):
    """A provider answered with a refusal, or did not answer. Its own words, never ours."""


def operations_for(provider_key: str) -> dict[str, Operation] | None:
    if provider_key == "twilio":
        from app.providers.twilio.accounts import OPERATIONS

        return OPERATIONS
    if provider_key == "openai":
        from app.providers.openai.accounts import OPERATIONS

        return OPERATIONS
    if provider_key == "anthropic":
        from app.providers.anthropic.accounts import OPERATIONS

        return OPERATIONS
    if provider_key == "google":
        from app.providers.google.accounts import OPERATIONS

        return OPERATIONS
    return None
