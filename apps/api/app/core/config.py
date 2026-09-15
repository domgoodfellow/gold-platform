"""What this deployment is configured with.

Nothing here has a default that would let the service run half-configured. A missing value
means the feature is off, and the handler says so rather than guessing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _publishable_key() -> str | None:
    """The low-privilege PostgREST `apikey`, under its current and its legacy name.

    `SUPABASE_PUBLISHABLE_KEY` is the target name (matches `apps/web`'s
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). `SUPABASE_ANON_KEY` is read only as a **temporary**
    fallback for a deployment not yet migrated — never the other way round, so a deployment that
    sets both is already on the target name. Neither key is privileged; the safety property this
    project depends on (D14, D26) is that this is never a service-role/secret key, not which of
    these two names it arrives under.
    """
    return os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")


@dataclass(frozen=True)
class Settings:
    """Everything the Stripe handler needs, or nothing.

    Read once at import. A partially configured deployment is treated as unconfigured: with a
    secret but no signing secret, the only thing this service could do is trust an unverified
    payload, which is worse than being switched off.
    """

    supabase_url: str
    supabase_publishable_key: str
    supabase_jwt_secret: str
    stripe_signing_secret: str


def load_settings() -> Settings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
        # NOT the service-role key, and the distinction is the whole of D26. This signs a
        # short-lived token for the `payment_webhook` Postgres role, which holds no grant on
        # any table and exactly one execute. A service-role key would discard RLS entirely.
        "supabase_jwt_secret": os.environ.get("SUPABASE_JWT_SECRET"),
        "stripe_signing_secret": os.environ.get("STRIPE_WEBHOOK_SECRET"),
    }

    if not all(values.values()):
        return None

    return Settings(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class PlatformBillingSettings:
    """What hearing from GOLD's own billing account about a subscription needs.

    **A separate dataclass from `Settings` above, deliberately, even though both mint a token for
    a narrow machine role and read a signing secret.** The vendor may be the same; the account and
    the money direction are not (constraints.md, "Commercial" — GOLD Plans & Billing is the
    opposite plane from Financial Operations). Folding the two together would make one
    destination's signing secret readable by the other's handler, and a leaked
    `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET` would then also authenticate as `payment_webhook`.
    """

    supabase_url: str
    supabase_publishable_key: str
    supabase_jwt_secret: str
    signing_secret: str


def load_platform_billing_settings() -> PlatformBillingSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
        # Signs a 60-second token for `platform_billing_webhook`, which holds no grant on any
        # table and exactly two executes. Not the service-role key, which D14 refuses.
        "supabase_jwt_secret": os.environ.get("SUPABASE_JWT_SECRET"),
        "signing_secret": os.environ.get("STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET"),
    }

    if not all(values.values()):
        return None

    return PlatformBillingSettings(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class RunnerSettings:
    """What the automation tick needs.

    **Separate from `Settings` above, because the two features are separately configurable.**
    A deployment that takes cards and runs no automations, or the other way round, is an
    ordinary deployment — and folding them into one dataclass would mean either switch turning
    the other off.

    The mail and message providers are deliberately absent: `app.channels.registry` reads its own
    environment per channel, so a deployment can send email and not text messages without either
    being half-configured.
    """

    supabase_url: str
    supabase_publishable_key: str
    supabase_jwt_secret: str
    # What Vercel's scheduler presents. Without it the tick is reachable by anybody who knows
    # the path, which is a stranger able to make this platform send a business's messages.
    cron_secret: str


@dataclass(frozen=True)
class AssistantSettings:
    """What answering a question needs, and it is deliberately the shortest of the three.

    **No JWT secret.** The other two dataclasses hold one because they mint a token for a
    machine role; this feature forwards the operator's own and has nothing to sign (D34). A
    deployment that can answer questions therefore holds strictly less than one that can send a
    message, which is the right way round.

    **No model key either.** `app.ai.registry` reads its own environment per provider, exactly as
    `app.channels.registry` does per channel -- so a deployment answering with a local model
    holds no vendor key at all, and nothing here has to be told which case it is in.
    """

    supabase_url: str
    supabase_publishable_key: str


def load_assistant_settings() -> AssistantSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
    }

    if not all(values.values()):
        return None

    return AssistantSettings(**values)  # type: ignore[arg-type]


def load_runner_settings() -> RunnerSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
        # Signs a 60-second token for `automation_runner`, which holds no grant on any table and
        # three executes. Not the service-role key, which D14 refuses.
        "supabase_jwt_secret": os.environ.get("SUPABASE_JWT_SECRET"),
        "cron_secret": os.environ.get("CRON_SECRET"),
    }

    if not all(values.values()):
        return None

    return RunnerSettings(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class DomainSettings:
    """What a domain command needs, and it is the same two fields as `AssistantSettings`.

    **A separate name rather than reusing that one.** `apps/api/app/domains/**` is a fourth
    feature by the same reasoning `RunnerSettings` gives for the second and third: a deployment
    answering questions and a deployment accepting CRM/Voice writes are separately switchable,
    even though today they read the same two environment variables. Naming this after the
    assistant feature would tie a change to that feature to something it has nothing to do with.

    **No JWT secret, for the same reason `AssistantSettings` has none.** A domain command forwards
    the operator's own token (D17, D34) rather than minting one for a machine role.
    """

    supabase_url: str
    supabase_publishable_key: str


def load_domain_settings() -> DomainSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
    }

    if not all(values.values()):
        return None

    return DomainSettings(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class VoiceSettings:
    """What hearing from the carrier needs.

    **A fourth dataclass rather than a field on one of the others**, for the reason the second
    and third exist: a deployment that runs a floor and takes no cards, or takes cards and has
    no telephone, is an ordinary deployment. Folding them together would mean either switch
    turning the other off.

    **The auth token is here and not in a registry**, unlike the message and model providers.
    Those registries choose *which vendor sends*; this is the shared secret that proves an
    unauthenticated request came from the one carrying the calls, and there is nothing to
    choose between -- an endpoint with no token cannot verify anything and must not exist.
    """

    supabase_url: str
    supabase_publishable_key: str
    # Signs a 60-second token for `voice_webhook`, which holds no grant on any table and one
    # execute. Not the service-role key, which D14 refuses.
    supabase_jwt_secret: str
    # The carrier signs every callback with this. Without it the endpoints below would accept
    # anything, which is a stranger writing calls into a business's record.
    twilio_auth_token: str


def load_voice_settings() -> VoiceSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_publishable_key": _publishable_key(),
        "supabase_jwt_secret": os.environ.get("SUPABASE_JWT_SECRET"),
        "twilio_auth_token": os.environ.get("TWILIO_AUTH_TOKEN"),
    }

    if not all(values.values()):
        return None

    return VoiceSettings(**values)  # type: ignore[arg-type]


def environment_warnings() -> list[str]:
    """Partial configuration this deployment's own graceful-degradation rules cannot see.

    Every `load_*` function above already treats *any* missing value in its group as the whole
    feature being off (D31) — that is correct and not what this checks. What none of them can
    catch is `app.ai.registry.answering_provider()`, which chooses between two *separate*
    providers rather than one group: `ASSISTANT_BASE_URL` set without `ASSISTANT_MODEL` (or the
    other way round) does not disable anything, it silently falls through to whichever provider
    is checked next — a deployment that believes it configured a self-hosted model but is quietly
    answering with the hosted default, or vice versa. That is worth a warning nothing today prints.

    Advisory only: nothing here raises, and callers choose what to do with the list. Consistent
    with dev.py's own reasoning that a deployment with unset settings should still start.
    """
    warnings: list[str] = []

    base_url = os.environ.get("ASSISTANT_BASE_URL")
    model = os.environ.get("ASSISTANT_MODEL")
    if bool(base_url) != bool(model):
        set_name, missing_name = ("ASSISTANT_BASE_URL", "ASSISTANT_MODEL") if base_url else ("ASSISTANT_MODEL", "ASSISTANT_BASE_URL")
        warnings.append(
            f"{set_name} is set but {missing_name} is not — both are required together, so "
            "answering is falling back to ANTHROPIC_API_KEY (or is unconfigured) rather than "
            "using the endpoint this deployment thinks it pointed at."
        )

    return warnings
