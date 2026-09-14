"""Reaching Postgres as a writer with no human caller.

**TEMPORARY LEGACY COMPATIBILITY.** `machine_token` signs with `SUPABASE_JWT_SECRET`, Supabase's
legacy shared HS256 secret — never used for a human caller (see `app/auth`, which verifies
people's tokens through JWKS and holds no signing key at all). This module is scoped to exactly
two machine Postgres roles, each with a handful of `execute` grants and no table grant, which is
the property worth keeping through the migration named in `SETUP.md`'s "SUPABASE_JWT_SECRET
pre-flight" and the docstring of `machine_token` below. Do not extend this module's reach while
that migration is open — narrow the machine identity further, never generalise it.

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

from app.core.config import Settings, VoiceSettings

ROLE = "payment_webhook"

# The integration's own auth.users row, fixed in 20260829000008_payment_provider.sql. It has
# no email and no password: the only way to act as it is to hold the JWT secret.
INTEGRATION_ACTOR = "00000000-0000-4000-8000-0000000000a1"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def machine_token(
    secret: str,
    *,
    role: str = ROLE,
    sub: str = INTEGRATION_ACTOR,
    now: int | None = None,
    ttl_seconds: int = 60,
) -> str:
    """Mint a short-lived HS256 token for a machine role.

    Short-lived on purpose: issued per request, stored nowhere, and there is nothing that
    would reuse it.

    **The role and the actor are arguments now, and there are two callers.** The second is the
    automation runner (`app.core.runner`), which is the same idea on a different axis: its own
    Postgres role, its own tiny set of grants, and its own `auth.users` row that cannot sign in.
    Generalising this rather than copying it is what keeps there being exactly one place that
    knows how a machine identifies itself here.
    """
    issued = int(time.time()) if now is None else now
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(
        json.dumps(
            {
                "role": role,
                "sub": sub,
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
            "apikey": settings.supabase_publishable_key,
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


VOICE_ROLE = "voice_webhook"

# The voice integration's own auth.users row, fixed in
# 20260905000002_a_call_is_a_conference_and_the_carrier_reports_back.sql. Like the payment one:
# no email, no password, and the only way to act as it is to hold the JWT secret.
VOICE_ACTOR = "00000000-0000-4000-8000-0000000000a2"


def record_call_event(
    settings: VoiceSettings,
    *,
    external_id: str,
    source: str,
    raw_status: str | None,
    status: str | None,
    duration_seconds: int | None,
    recording_url: str | None,
    payload: dict[str, str],
    payload_hash: str,
) -> str | None:
    """Apply one thing the carrier said about one call.

    **The only thing this role may do**, and every value deciding *where* it lands -- the
    organization, the customer, the call -- is derived inside the function from the row the
    carrier's identifier already belongs to. A callback that could name an organization could
    name somebody else's.

    Returns the event id, or `None` for a callback about a call this platform has no record of
    and for one already applied. Both are a 200 to the carrier: retrying will not change either
    answer, and telling the two apart would be telling a stranger which identifiers are real.
    """
    token = machine_token(settings.supabase_jwt_secret, role=VOICE_ROLE, sub=VOICE_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_call_event",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_external_id": external_id,
            "p_source": source,
            "p_raw_status": raw_status,
            "p_status": status,
            "p_duration": duration_seconds,
            "p_recording_url": recording_url,
            "p_payload": payload,
            "p_payload_hash": payload_hash,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_call_event failed: {response.status_code}")

    return response.json()
