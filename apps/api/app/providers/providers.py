"""Which vendor module answers for a provider key.

**The one place a provider key is turned into an implementation.** `app.domains.providers` asks
for the operations of `provider_key` and never imports a vendor. A provider with no entry
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


class CredentialRejected(UpstreamRefused):
    """The provider refused GildOps' own credential -- missing, invalid, restricted or suspended.

    Kept apart from a plain refusal because the two mean opposite things to the business asking: a
    rejected credential is GildOps' account being unusable, and must never reach a tenant as a
    problem with the name it typed. A caller turns this into *the provider is unavailable*.
    """


def domain_hosting_for(provider_key: str):
    """The module that attaches a business's hostname at `provider_key`, or `None`.

    `app.domains.web_delivery` asks for it by the key the domain row carries and never imports a
    vendor. The module answers `connect`, `check` and `remove`.
    """
    if provider_key == "vercel":
        from app.providers.vercel import domains

        return domains
    return None


def email_domains_for(provider_key: str):
    """The module that proves a business's sending domain at `provider_key`, or `None`.

    `app.services.email_provisioning` asks for it by the key the binding carries and never imports
    a vendor, exactly as `domain_hosting_for` above does for the hosting side. The module
    answers `ensure`, `get`, `verify` and `remove`.
    """
    if provider_key == "resend":
        from app.providers.resend import domains

        return domains
    return None


def tenant_email_for(provider_key: str):
    """The module that sends, confirms and reads back a *business's* email at `provider_key`, or `None`.

    `app.services.tenant_email` asks for it by the key the sending domain's binding carries and never
    imports a vendor. Distinct from `email_domains_for` (proving a name) and from GildOps' own
    platform sender: this is an organization's message to a person.
    """
    if provider_key == "resend":
        from app.providers.resend import email

        return email
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
    if provider_key == "resend":
        from app.providers.resend.accounts import OPERATIONS

        return OPERATIONS
    return None
