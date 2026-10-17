"""Stripe, and the only place this repository's Python knows it exists.

**No SDK, and it is the same decision the TypeScript side made.** What this needs is one HMAC
and one JSON parse, both specified and stable. An SDK would add a dependency whose surface
nothing here uses, and it would want a network at import time -- which makes the handler
untestable without one, in a repository whose testing discipline is running against real things
rather than fakes. Everything below is pure and is tested directly, signature and all.

**The web app also talks to Stripe, and the split is the web/API runtime split's rather than an accident.** Creating a
checkout session is an operator pressing a button inside a transactional flow, and the web/API runtime split gives the
transactional domain to TypeScript. Being *called* by Stripe with no session behind it is
webhook ingress, which the web/API runtime split gives to Python. Two touchpoints, each owned by whoever owns the
write -- and the cost is that the vendor is named in two runtimes, stated here rather than
discovered later.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass

DEFAULT_TOLERANCE_SECONDS = 300

# One event type. Stripe reports a great deal about its own world and almost none of it is a
# payment this platform asked for; acting on more would be inventing meaning on the vendor's
# behalf, which is the other half of *a vendor is authoritative for its own events only*.
SETTLED = "checkout.session.completed"


@dataclass(frozen=True)
class ProviderPayment:
    """A payment the provider is telling us about.

    Deliberately thin. Nothing in this shape lets Stripe say anything about a work item, an
    invoice or a business -- which invoice it settles is resolved from `request_id` against a
    row this platform wrote first.
    """

    request_id: str
    provider: str
    provider_reference: str
    amount_minor: int
    currency: str


def verify_signature(
    *,
    body: str,
    signature: str | None,
    signing_secret: str,
    now: int,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> bool:
    """Check a `Stripe-Signature` header against the raw body.

    The timestamp is inside the signed payload precisely so that whoever replays a callback
    cannot move it, which is what makes the tolerance meaningful rather than decorative.
    """
    if not signature:
        return False

    timestamp = None
    candidates = []
    for piece in signature.split(","):
        key, _, value = piece.strip().partition("=")
        if key == "t" and not timestamp:
            timestamp = value
        elif key == "v1":
            candidates.append(value)

    if not timestamp or not candidates:
        return False

    try:
        sent = int(timestamp)
    except ValueError:
        return False

    if abs(now - sent) > tolerance_seconds:
        return False

    expected = hmac.new(
        signing_secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256
    ).hexdigest()

    # Several `v1` signatures arrive during a secret rotation, and any one matching is the
    # event being genuine. `compare_digest` throughout: a timing signal here is a signal about
    # a secret.
    return any(hmac.compare_digest(candidate, expected) for candidate in candidates)


def settlement(
    *, body: str, signature: str | None, signing_secret: str, now: int
) -> ProviderPayment | None:
    """Turn a signed callback into a payment, or None for an event we do not act on.

    Raises when the signature does not check out. The caller must not distinguish that from
    any other failure, and must never fall back to trusting the body.
    """
    if not verify_signature(
        body=body, signature=signature, signing_secret=signing_secret, now=now
    ):
        raise ValueError("that callback did not come from stripe")

    event = json.loads(body)
    if event.get("type") != SETTLED:
        return None

    session = (event.get("data") or {}).get("object") or {}

    request_id = session.get("client_reference_id")
    provider_reference = session.get("id")
    amount_minor = session.get("amount_total")
    currency = session.get("currency")

    # A completed session missing any of these is not one of ours. None rather than an
    # exception is what lets the handler answer 200 and stop the retries.
    if not isinstance(request_id, str) or not isinstance(provider_reference, str):
        return None
    if not isinstance(amount_minor, int) or not isinstance(currency, str):
        return None

    return ProviderPayment(
        request_id=request_id,
        provider="stripe",
        provider_reference=provider_reference,
        amount_minor=amount_minor,
        # Stripe lower-cases currency codes; every currency column in this schema is
        # `^[A-Z]{3}$`.
        currency=currency.upper(),
    )
