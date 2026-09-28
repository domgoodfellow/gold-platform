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


class HostnameUnavailable(UpstreamRefused):
    """The provider will not take this hostname at all -- claimed by somebody else there, or not
    a name it accepts. A fact about the name, not about the request, so retrying will not help."""


class MalformedAnswer(UpstreamRefused):
    """The provider answered, but not in a shape its adapter can read."""


def domain_hosting_for(provider_key: str):
    """The module that attaches a business's hostname at `provider_key`, or `None`.

    `app.domains.web_delivery` asks for it by the key the domain row carries and never imports a
    vendor (I15). The module answers `connect`, `check` and `remove`.
    """
    if provider_key == "vercel":
        from app.providers.vercel import domains

        return domains
    return None


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
    if provider_key == "vercel":
        from app.providers.vercel.domains import OPERATIONS

        return OPERATIONS
    return None
