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
