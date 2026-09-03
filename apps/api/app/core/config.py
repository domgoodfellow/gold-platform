"""What this deployment is configured with.

Nothing here has a default that would let the service run half-configured. A missing value
means the feature is off, and the handler says so rather than guessing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Everything the Stripe handler needs, or nothing.

    Read once at import. A partially configured deployment is treated as unconfigured: with a
    secret but no signing secret, the only thing this service could do is trust an unverified
    payload, which is worse than being switched off.
    """

    supabase_url: str
    supabase_anon_key: str
    supabase_jwt_secret: str
    stripe_signing_secret: str


def load_settings() -> Settings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY"),
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
    supabase_anon_key: str
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
    supabase_anon_key: str


def load_assistant_settings() -> AssistantSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY"),
    }

    if not all(values.values()):
        return None

    return AssistantSettings(**values)  # type: ignore[arg-type]


def load_runner_settings() -> RunnerSettings | None:
    values = {
        "supabase_url": os.environ.get("SUPABASE_URL"),
        "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY"),
        # Signs a 60-second token for `automation_runner`, which holds no grant on any table and
        # three executes. Not the service-role key, which D14 refuses.
        "supabase_jwt_secret": os.environ.get("SUPABASE_JWT_SECRET"),
        "cron_secret": os.environ.get("CRON_SECRET"),
    }

    if not all(values.values()):
        return None

    return RunnerSettings(**values)  # type: ignore[arg-type]
