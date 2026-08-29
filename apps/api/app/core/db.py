"""Reaching Postgres as a writer with no human caller.

**This is the half of the Stripe slice that was never about which language.**
`docs/constraints.md` D26: what is distinctive about a webhook is that it arrives with no
human session, which is an authorization problem, and the answer is the same either way — its
own Postgres role, its own policies, and emphatically not service-role.

**Identity still arrives as a JWT** (D17); it simply is not a person's. The token names the
role PostgREST switches into and a `sub` that is a real `auth.users` row, so `auth.uid()`
answers and `events.actor_id` is satisfiable. That is what let I11 keep a single shape rather
than growing a nullable actor for machines.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import httpx

from app.core.config import Settings

ROLE = "payment_webhook"

# The integration's own auth.users row, fixed in 20260829000008_payment_provider.sql. It has
# no email and no password: the only way to act as it is to hold the JWT secret.
INTEGRATION_ACTOR = "00000000-0000-4000-8000-0000000000a1"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def machine_token(secret: str, *, now: int | None = None, ttl_seconds: int = 60) -> str:
    """Mint a short-lived HS256 token for the machine role.

    Short-lived on purpose: issued per request, stored nowhere, and there is nothing that
    would reuse it.
    """
    issued = int(time.time()) if now is None else now
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(
        json.dumps(
            {
                "role": ROLE,
                "sub": INTEGRATION_ACTOR,
                "aud": "authenticated",
                "iat": issued,
                "exp": issued + ttl_seconds,
            },
            separators=(",", ":"),
        ).encode()
    )
    signature = _b64(
        hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{payload}.{signature}"


def record_provider_payment(
    settings: Settings,
    *,
    request_id: str,
    provider: str,
    provider_reference: str,
    amount_minor: int,
) -> str | None:
    """Write down a payment the processor says it took.

    **The only thing this service may do.** Every value that decides *where* it lands — the
    organization, the invoice, the currency — is derived inside the function from the
    `payment_requests` row named by `request_id`. A webhook that could name an invoice could
    name somebody else's.

    Returns the payment id, or `None` when this platform has no record of asking for it —
    which the handler turns into a 200, because retrying will not make the row appear.
    """
    token = machine_token(settings.supabase_jwt_secret)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_provider_payment",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_request_id": request_id,
            "p_provider": provider,
            "p_provider_reference": provider_reference,
            "p_amount_minor": amount_minor,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        body = response.json() if response.headers.get("content-type", "").startswith(
            "application/json"
        ) else {}
        # GD003: a verified payment against a request nobody here made.
        if body.get("code") == "GD003" or "no payment was requested" in str(body):
            return None
        raise RuntimeError(f"record_provider_payment failed: {response.status_code}")

    return response.json()
