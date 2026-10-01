"""Verifying a Resend webhook before anything in its body is trusted (D56, restated for a stranger).

**Resend signs its webhooks the way Svix does** -- three headers (`svix-id`, `svix-timestamp`,
`svix-signature`) over the exact bytes that arrived, never the parsed JSON (a reformatted body
would not reproduce the same signature). A missing header, a stale timestamp or a signature that
does not match is one answer: refused, before a single field of the payload is read.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

# How old a callback may be before it is treated as a replay rather than a late delivery.
_TOLERANCE_SECONDS = 300


class SignatureInvalid(ValueError):
    """The callback is missing a header, is too old, or its signature does not match."""


def verify_signature(
    *,
    secret: str,
    svix_id: str | None,
    svix_timestamp: str | None,
    svix_signature: str | None,
    body: bytes,
    now: int | None = None,
) -> None:
    if not svix_id or not svix_timestamp or not svix_signature:
        raise SignatureInvalid("missing signature headers")

    try:
        issued = int(svix_timestamp)
    except ValueError as failure:
        raise SignatureInvalid("malformed timestamp") from failure

    current = int(time.time()) if now is None else now
    if abs(current - issued) > _TOLERANCE_SECONDS:
        raise SignatureInvalid("timestamp outside tolerance")

    raw_secret = secret.removeprefix("whsec_")
    key = base64.b64decode(raw_secret)
    signed_content = f"{svix_id}.{issued}.{body.decode('utf-8', errors='strict')}".encode()
    expected = base64.b64encode(hmac.new(key, signed_content, hashlib.sha256).digest()).decode()

    # Resend sends one or more space-separated `v1,<signature>` entries; any match is accepted,
    # the same tolerance Svix's own verifier gives for in-flight secret rotation.
    candidates = [part.split(",", 1)[1] for part in svix_signature.split() if part.startswith("v1,")]
    if not candidates or not any(hmac.compare_digest(expected, candidate) for candidate in candidates):
        raise SignatureInvalid("signature does not match")


# GildOps' own delivery vocabulary, for Resend's own event names. One remaining external setup
# step this repository cannot do for a deployment: registering a webhook at Resend for exactly
# these six event types, pointed at this endpoint (see the completion report).
_EVENT_STATE = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delayed",
    "email.bounced": "bounced",
    "email.failed": "failed",
    "email.suppressed": "suppressed",
}


def parse_event(body: dict) -> dict | None:
    """Resend's own event shape, turned into `{message_id, state, detail}` -- or `None` for an
    event type this platform does not track (D56: the vendor's shape goes no further than this
    file). A webhook handler records nothing for `None`, which is a 200, not a refusal: an event
    this platform does not act on is not a failure to understand it."""
    if not isinstance(body, dict):
        return None
    state = _EVENT_STATE.get(str(body.get("type") or ""))
    if state is None:
        return None
    data = body.get("data")
    if not isinstance(data, dict):
        return None
    message_id = data.get("email_id")
    if not message_id:
        return None
    reason = data.get("reason") if isinstance(data.get("reason"), str) else None
    return {"message_id": str(message_id), "state": state, "detail": reason}
