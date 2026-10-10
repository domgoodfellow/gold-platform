"""A connection's stored credential: reading it, and renewing it without two callers undoing each other.

**Only reached after authorization.** Nothing in here decides whether anyone may use a connection;
`operations` proves the caller manages it and `executor` proves the principal holds a live grant, and
both do that before calling this. What this owns is the one fact about a token that must not race: a
vendor that rotates its refresh token invalidates the old one the moment it issues the new one, so two
requests that both find the token near expiry would otherwise leave a stale pair stored.
"""

from __future__ import annotations

import json
import time

from app.connectors.base import OAuthApp, OAuthProvider, Tokens
from app.core import db
from app.core.config import IntegrationSettings
from app.providers.providers import UpstreamRefused

# A token this close to expiring is refreshed before it is used.
REFRESH_MARGIN_SECONDS = 120


def pack(tokens: Tokens) -> str:
    return json.dumps(
        {"access_token": tokens.access_token, "refresh_token": tokens.refresh_token, "expires_at": tokens.expires_at}
    )


def held(settings: IntegrationSettings, connection_id: str) -> dict | None:
    row = db.read_integration_credential(settings, connection_id=connection_id)
    if not row or not row.get("secret"):
        return None
    try:
        parsed = json.loads(row["secret"])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _fresh(credential: dict) -> bool:
    return int(credential.get("expires_at", 0)) - REFRESH_MARGIN_SECONDS > int(time.time())


def usable_token(
    settings: IntegrationSettings, provider: OAuthProvider, app: OAuthApp, connection_id: str, credential: dict
) -> tuple[str, list[str] | None]:
    """The access token to use now, renewing it first when it is near expiry.

    The renewed pair is stored with a compare-and-swap on the refresh token it was renewed from. A
    caller that loses that race does not overwrite the winner: it uses whatever is now on file.
    """
    if _fresh(credential):
        return credential["access_token"], None

    refresh_token = credential.get("refresh_token")
    if not refresh_token:
        raise UpstreamRefused("The sign-in has expired and cannot be renewed. Reconnect it.")

    try:
        renewed = provider.refresh(app, refresh_token=refresh_token)
    except UpstreamRefused:
        # A vendor that rotates refresh tokens refuses the old one once a concurrent caller has used it.
        current = held(settings, connection_id)
        if current and current.get("refresh_token") != refresh_token and _fresh(current):
            return current["access_token"], None
        raise

    if db.swap_integration_credential(
        settings, connection_id=connection_id, expected_refresh_token=refresh_token, secret=pack(renewed)
    ):
        return renewed.access_token, renewed.scopes or None

    current = held(settings, connection_id)
    if current and _fresh(current):
        return current["access_token"], None
    return renewed.access_token, renewed.scopes or None
