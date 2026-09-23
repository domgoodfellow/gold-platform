"""Reaching Postgres as a writer with no human caller.

**TEMPORARY LEGACY COMPATIBILITY.** `machine_token` signs with `SUPABASE_JWT_SECRET`, Supabase's
legacy shared HS256 secret — never used for a human caller (see `app/auth`, which verifies
people's tokens through JWKS and holds no signing key at all). This module is scoped to a
handful of machine Postgres roles, each with a small set of `execute` grants and no table grant,
which is the property worth keeping through the migration named in `SETUP.md`'s
"SUPABASE_JWT_SECRET pre-flight" and the docstring of `machine_token` below. Do not extend this
module's reach while that migration is open — narrow the machine identity further, never
generalise it. `platform_billing_webhook` is the third such role, added alongside
`payment_webhook` and `voice_webhook` rather than folding into either — its own Stripe account,
its own signing secret, its own actor.

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
from typing import TYPE_CHECKING

import httpx

from app.core.config import (
    IntegrationSettings,
    PlatformBillingSettings,
    ProviderOperationsSettings,
    Settings,
    VoiceSettings,
)

if TYPE_CHECKING:
    from app.providers.stripe.platform_billing_webhook import NoticeEvent, SubscriptionEvent

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


PLATFORM_BILLING_ROLE = "platform_billing_webhook"

# GOLD's own billing integration's `auth.users` row, fixed in
# 20260922000004_gold_bills_the_organization_its_own_subscription.sql. Like the payment and
# voice integrations: no email, no password, and the only way to act as it is to hold the JWT
# secret.
PLATFORM_BILLING_ACTOR = "00000000-0000-4000-8000-0000000000a3"


def apply_platform_subscription_event(
    settings: PlatformBillingSettings,
    *,
    event: SubscriptionEvent,
) -> str | None:
    """Apply one `customer.subscription.*` event. The only thing this role may do besides
    `record_platform_billing_notice` below -- every value deciding *where* it lands is derived
    inside the function from `platform_billing_customers`, never trusted from the event itself.

    Returns the organization id acted on, or `None` for an event about a customer this platform
    never provisioned, or one already applied (idempotent by the processor's own event
    reference) -- both a 200 to the processor, since retrying changes neither answer.
    """
    token = machine_token(settings.supabase_jwt_secret, role=PLATFORM_BILLING_ROLE, sub=PLATFORM_BILLING_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/apply_platform_subscription_event",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_event_reference": event.event_reference,
            "p_event_type": event.event_type,
            "p_customer_reference": event.customer_reference,
            "p_subscription_reference": event.subscription_reference,
            "p_price_reference": event.price_reference,
            "p_status": event.status,
            "p_currency": event.currency,
            "p_current_period_start": event.current_period_start,
            "p_current_period_end": event.current_period_end,
            "p_cancel_at_period_end": event.cancel_at_period_end,
            "p_canceled_at": event.canceled_at,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"apply_platform_subscription_event failed: {response.status_code}")

    return response.json()


def record_platform_billing_notice(
    settings: PlatformBillingSettings,
    *,
    event: NoticeEvent,
) -> str | None:
    """Log an `invoice.paid`/`invoice.payment_failed` event to the idempotency ledger. Never a
    subscription-status writer -- see `platform_billing_webhook.py`'s module docstring for why.
    """
    token = machine_token(settings.supabase_jwt_secret, role=PLATFORM_BILLING_ROLE, sub=PLATFORM_BILLING_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_platform_billing_notice",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_event_reference": event.event_reference,
            "p_event_type": event.event_type,
            "p_customer_reference": event.customer_reference,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_platform_billing_notice failed: {response.status_code}")

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


PROVIDER_ROLE = "provider_operator"

# The provider-operations integration's own `auth.users` row, fixed in
# 20260929000001_platform_provider_accounts.sql. No email, no password.
PROVIDER_ACTOR = "00000000-0000-4000-8000-0000000000a4"


def read_provider_account_credential(
    settings: ProviderOperationsSettings,
    *,
    account_id: str,
) -> dict | None:
    """One GOLD provider account's decrypted credential, or `None` for an account that is
    absent, disabled or has none stored.

    **The only place in this repository a decrypted secret is read.** The caller has already
    proved the human asking is platform staff; the value returned here goes to one upstream
    request and is never logged, stored, or put in a response.
    """
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/read_provider_account_credential",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_account_id": account_id},
        timeout=10.0,
    )

    if response.status_code >= 400:
        # Deliberately no body: an error from this call could echo an argument, and nothing here
        # may put a credential-adjacent value into an exception message.
        raise RuntimeError(f"read_provider_account_credential failed: {response.status_code}")

    rows = response.json()
    return rows[0] if rows else None


def resolve_ai_runtime_assignment(
    settings: ProviderOperationsSettings,
    *,
    capability: str,
) -> dict | None:
    """The provider, service and account assigned to one AI capability, or `None` if unassigned.

    Uses the same `provider_operator` role and token `read_provider_account_credential` does --
    resolving an assignment is one step in the same trusted path, not a second axis (D45's
    reasoning: a narrow role does one small job well, not several unrelated ones cheaply).
    """
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/resolve_ai_runtime_assignment",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_capability": capability},
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"resolve_ai_runtime_assignment failed: {response.status_code}")

    rows = response.json()
    return rows[0] if rows else None


def record_provider_account_verification(
    settings: ProviderOperationsSettings,
    *,
    account_id: str,
    ok: bool,
    error: str | None,
    metadata: dict,
) -> None:
    """Record what the provider said when this runtime asked it. Only this role may."""
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_provider_account_verification",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_account_id": account_id,
            "p_ok": ok,
            "p_error": error,
            "p_metadata": metadata,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_provider_account_verification failed: {response.status_code}")


INTEGRATION_ROLE = "integration_operator"

# The integration-credentials integration's own `auth.users` row, fixed in
# 20260929000005_integration_credentials_and_oauth.sql. No email, no password.
INTEGRATION_CREDENTIALS_ACTOR = "00000000-0000-4000-8000-0000000000a5"


def _integration_rpc(settings: IntegrationSettings, function: str, payload: dict) -> object:
    """One call to one of `integration_operator`'s five doors.

    **Deliberately no response body in a failure**: an error from these calls could echo an
    argument, and nothing here may put a credential-adjacent value into an exception message.
    """
    token = machine_token(settings.supabase_jwt_secret, role=INTEGRATION_ROLE, sub=INTEGRATION_CREDENTIALS_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/{function}",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"{function} failed: {response.status_code}")

    return response.json() if response.content else None


def read_integration_credential(settings: IntegrationSettings, *, connection_id: str) -> dict | None:
    """A connection's decrypted credential, or `None` for one that is absent, disconnected or has
    none. **The only place in this repository a tenant's decrypted credential is read.**"""
    rows = _integration_rpc(settings, "read_integration_credential", {"p_connection_id": connection_id})
    return rows[0] if rows else None  # type: ignore[index]


def store_integration_credential(settings: IntegrationSettings, *, connection_id: str, secret: str) -> None:
    _integration_rpc(settings, "store_integration_credential", {"p_connection_id": connection_id, "p_secret": secret})


def record_integration_health(
    settings: IntegrationSettings,
    *,
    connection_id: str,
    ok: bool,
    error: str | None = None,
    account_label: str | None = None,
    scopes: list[str] | None = None,
) -> None:
    _integration_rpc(
        settings,
        "record_integration_health",
        {
            "p_connection_id": connection_id,
            "p_ok": ok,
            "p_error": error,
            "p_account_label": account_label,
            "p_scopes": scopes,
        },
    )


def replace_integration_resources(settings: IntegrationSettings, *, connection_id: str, resources: list[dict]) -> None:
    _integration_rpc(
        settings, "replace_integration_resources", {"p_connection_id": connection_id, "p_resources": resources}
    )


def clear_integration_credential(settings: IntegrationSettings, *, connection_id: str) -> None:
    _integration_rpc(settings, "clear_integration_credential", {"p_connection_id": connection_id})
