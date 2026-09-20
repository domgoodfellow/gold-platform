"""The `state` that binds a provider's redirect back to the person and business that began it.

Signed, short-lived and single-purpose: it names the business, the person, the connector and the
connection being reconnected, plus a nonce that must also arrive in the browser's own cookie. A
`state` a stranger could forge would let them attach their account to somebody else's business; a
`state` that outlived its sign-in would let a leaked redirect be replayed. Nothing in it is secret,
so nothing in it is encrypted -- only authentic.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

TTL_SECONDS = 600


class StateInvalid(ValueError):
    """The state is forged, altered, expired, or not for this person."""


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: str, body: str) -> str:
    return _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())


def sign_state(secret: str, claims: dict, *, now: int | None = None) -> str:
    issued = int(time.time()) if now is None else now
    body = _b64(json.dumps({**claims, "exp": issued + TTL_SECONDS}, separators=(",", ":")).encode())
    return f"{body}.{_sign(secret, body)}"


def verify_state(secret: str, state: str, *, now: int | None = None) -> dict:
    try:
        body, signature = state.split(".", 1)
    except ValueError as failure:
        raise StateInvalid("malformed") from failure

    if not hmac.compare_digest(signature, _sign(secret, body)):
        raise StateInvalid("bad signature")

    try:
        claims = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError) as failure:
        raise StateInvalid("malformed") from failure

    current = int(time.time()) if now is None else now
    if not isinstance(claims, dict) or int(claims.get("exp", 0)) < current:
        raise StateInvalid("expired")
    return claims
