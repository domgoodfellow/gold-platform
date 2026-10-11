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
from datetime import datetime
from typing import TYPE_CHECKING

import httpx

from app.core.config import (
    IntegrationSettings,
    InvitationEmailWebhookSettings,
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
            "p_status": event.status,
            "p_currency": event.currency,
            "p_current_period_start": event.current_period_start,
            "p_current_period_end": event.current_period_end,
            "p_cancel_at_period_end": event.cancel_at_period_end,
            "p_canceled_at": event.canceled_at,
            "p_provider_event_created_at": event.provider_event_created_at,
            "p_items": event.item_payload,
            "p_checkout_correlation": event.checkout_correlation,
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


def record_inbound_call(
    settings: VoiceSettings,
    *,
    external_id: str,
    to_number: str,
    from_number: str,
    payload: dict[str, str],
    payload_hash: str,
) -> str | None:
    """An inbound call, recorded for the business whose number was rung.

    **The business is derived inside the function from `to_number`**, the carrier's own word for
    the number it dialled, and from nothing this handler could have been asked to trust: a callback
    that could name an organization could name somebody else's. Returns the call id, or `None` for
    a number no active business holds and for a call already recorded -- both a harmless answer.
    """
    token = machine_token(settings.supabase_jwt_secret, role=VOICE_ROLE, sub=VOICE_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_inbound_call",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_external_id": external_id,
            "p_to_number": to_number,
            "p_from_number": from_number,
            "p_payload": payload,
            "p_payload_hash": payload_hash,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_inbound_call failed: {response.status_code}")

    return response.json()


def record_call_leg(settings: VoiceSettings, *, conference_name: str, external_id: str) -> str | None:
    """Tell a call which carrier telephone is the agent's own, from the request that carries both.

    The room name was generated by this platform and cannot be guessed, and the request was signed
    by the carrier, so the leg it names is the leg that joined that room. The call is found from
    the room alone.
    """
    token = machine_token(settings.supabase_jwt_secret, role=VOICE_ROLE, sub=VOICE_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_call_leg",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_conference_name": conference_name, "p_external_id": external_id},
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_call_leg failed: {response.status_code}")

    return response.json()


SMS_ROLE = "sms_webhook"

# The messaging integration's own auth.users row, fixed in
# 20261016000001_communications_owns_messaging.sql. Like the voice one: no email, no password,
# and the only way to act as it is to hold the JWT secret.
SMS_ACTOR = "00000000-0000-4000-8000-0000000000a5"


def record_inbound_message(
    settings: VoiceSettings,
    *,
    to_number: str,
    from_number: str,
    external_id: str,
    body: str,
) -> str | None:
    """One inbound text, applied through `sms_webhook`'s one door.

    Organization and conversation are both derived *inside* `record_inbound_message` from
    `to_number`, the carrier's own -- never from an organization id this handler could otherwise
    have been asked to trust (D17): a callback that could name a business could name somebody
    else's.
    """
    token = machine_token(settings.supabase_jwt_secret, role=SMS_ROLE, sub=SMS_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_inbound_message",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "p_to_number": to_number,
            "p_from_number": from_number,
            "p_external_id": external_id,
            "p_body": body,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_inbound_message failed: {response.status_code}")
    return response.json()


def record_message_status(
    settings: VoiceSettings,
    *,
    external_id: str,
    status: str,
    failure_reason: str | None,
) -> str | None:
    """A carrier status callback for one outbound message, applied through `sms_webhook`."""
    token = machine_token(settings.supabase_jwt_secret, role=SMS_ROLE, sub=SMS_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_message_status",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"p_external_id": external_id, "p_status": status, "p_failure_reason": failure_reason},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_message_status failed: {response.status_code}")
    return response.json()


def record_message_suppression(
    settings: VoiceSettings,
    *,
    to_number: str,
    external_number: str,
    opted_out: bool,
) -> None:
    """STOP/START, applied through `sms_webhook`'s one door onto `messaging_opt_outs`.

    The organization is derived inside the function from `to_number`, same as
    `record_inbound_message` -- `sms_webhook` holds no table grant to resolve one any other way.
    """
    token = machine_token(settings.supabase_jwt_secret, role=SMS_ROLE, sub=SMS_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_message_suppression",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"p_to_number": to_number, "p_external_number": external_number, "p_opted_out": opted_out},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_message_suppression failed: {response.status_code}")


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


def resolve_public_assistant(
    settings: ProviderOperationsSettings,
    *,
    deployment_id: str,
    visitor_key: str | None = None,
) -> dict | None:
    """The business, the instructions its owner wrote and whether it holds the Agent, for one live
    website-chat deployment -- or `None` for a deployment that does not exist or is not live.

    **How the public chat endpoint learns which business it is answering for.** The request names
    a deployment and nothing else: an organization id or a block of instructions that arrived in
    the body would be values the caller chose, and the shared secret proves who the caller is, not
    that what it sent is true (D17, D22).
    """
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}" + ("/rest/v1/rpc/resolve_public_agent_turn" if visitor_key else "/rest/v1/rpc/resolve_public_assistant"),
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_deployment_id": deployment_id, **({"p_visitor_key": visitor_key} if visitor_key else {})},
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"resolve_public_assistant failed: {response.status_code}")

    rows = response.json()
    if visitor_key:
        return rows
    return rows[0] if rows else None


def record_ai_usage(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    capability: str,
    provider_key: str,
    input_tokens: int,
    output_tokens: int,
    reference: str,
) -> None:
    """Write down what one AI request consumed, as the two token meters.

    **The writer of `ai_tokens_input` and `ai_tokens_output`**, and a thin one: the database door
    hands both to `app.record_usage`, which decides what they are worth. Called once per request
    with that request's total, so nothing here sums and nothing records a model call twice.
    Idempotent on `reference`, so a retried call is the same fact.
    """
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_ai_usage",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_organization_id": organization_id,
            "p_capability": capability,
            "p_provider_key": provider_key,
            "p_input_tokens": input_tokens,
            "p_output_tokens": output_tokens,
            "p_reference": reference,
        },
        timeout=10.0,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"record_ai_usage failed: {response.status_code}")


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


def default_platform_provider_account(settings: ProviderOperationsSettings, *, provider_key: str) -> str | None:
    """The default active account id for one provider, or `None`. See `_provider_headers` below for
    the same machine identity every other `provider_operator` door in this module mints."""
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/default_platform_provider_account",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_provider_key": provider_key},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"default_platform_provider_account failed: {response.status_code}")
    return response.json() or None


def record_invitation_delivery(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    invitation_id: str,
    recipient: str,
    state: str,
    provider_message_id: str | None,
    detail: str | None,
) -> None:
    """What apps/api got back immediately after asking a provider to send one invitation's email.
    Same role as the credential read that made the send possible (`provider_operator`)."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_invitation_delivery",
        headers=_provider_headers(settings),
        json={
            "p_organization_id": organization_id,
            "p_invitation_id": invitation_id,
            "p_recipient": recipient,
            "p_state": state,
            "p_provider_message_id": provider_message_id,
            "p_detail": detail,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_invitation_delivery failed: {response.status_code}")


# --- a business's custom domain: three more doors on the same role, and no table grant ----------
#
# The same machine identity and the same trust path as the account doors above: `apps/api` proves
# the caller may manage this business's domains under the caller's own token first
# (`app.domains.web_delivery`), and only then asks which GildOps account answers, reads its
# credential, and records what the provider said. Recording a verification is this role's alone
# so that neither a tenant nor a staff token can mark a hostname verified that no provider checked.


def _provider_headers(settings: ProviderOperationsSettings) -> dict[str, str]:
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)
    return {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def custom_domain_provider_account(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    domain_id: str,
) -> str | None:
    """The GildOps provider account that answers for this domain, or `None` when none is active."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/custom_domain_provider_account",
        headers=_provider_headers(settings),
        json={"p_organization_id": organization_id, "p_domain_id": domain_id},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"custom_domain_provider_account failed: {response.status_code}")
    return response.json() or None


def record_custom_domain_registration(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    domain_id: str,
    configuration_state: str,
    dns_records: list[dict],
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """What the provider said when asked to attach the hostname -- or why it was never asked."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_custom_domain_registration",
        headers=_provider_headers(settings),
        json={
            "p_organization_id": organization_id,
            "p_domain_id": domain_id,
            "p_configuration_state": configuration_state,
            "p_dns_records": dns_records,
            "p_error_code": error_code,
            "p_error_message": error_message,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_custom_domain_registration failed: {response.status_code}")


def set_custom_domain_verification(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    domain_id: str,
    verification_state: str,
    configuration_state: str | None,
    ssl_state: str | None,
    dns_records: list[dict] | None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """What the provider said on a recheck. Idempotent at the database: the same answer twice is
    the same row."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/set_custom_domain_verification",
        headers=_provider_headers(settings),
        json={
            "p_organization_id": organization_id,
            "p_domain_id": domain_id,
            "p_verification_state": verification_state,
            "p_configuration_state": configuration_state,
            "p_ssl_state": ssl_state,
            "p_dns_records": dns_records,
            "p_error_code": error_code,
            "p_error_message": error_message,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"set_custom_domain_verification failed: {response.status_code}")


# --- a business's sending domain: two more doors on the same role, and no table grant ----------
#
# The same machine identity and the same trust path as the custom-domain doors above:
# `app.services.email_provisioning` proves under the caller's own token that this person may manage
# this business's email, and only then asks which GildOps account answers, reads its credential and
# records what the provider said. Recording the provisioning outcome is this role's alone so that
# neither a tenant nor a staff token can mark a sending domain usable that no provider checked.


def email_domain_provider_account(settings: ProviderOperationsSettings, *, organization_id: str) -> str | None:
    """The GildOps provider account that answers for this business's sending domains, or `None`."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/email_domain_provider_account",
        headers=_provider_headers(settings),
        json={"p_organization_id": organization_id},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"email_domain_provider_account failed: {response.status_code}")
    return response.json() or None


def record_email_domain_provisioning(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    resource_id: str,
    status: str,
    provider_domain_id: str | None = None,
    provider_status: str | None = None,
    dns_records: list[dict] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """What the provider said about a sending domain the tenant already named. Creates nothing: a
    resource that does not exist is a refusal, not a new row."""
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_email_domain_provisioning",
        headers=_provider_headers(settings),
        json={
            "p_organization_id": organization_id,
            "p_resource_id": resource_id,
            "p_status": status,
            "p_provider_domain_id": provider_domain_id,
            "p_provider_status": provider_status,
            "p_dns_records": dns_records,
            "p_error_code": error_code,
            "p_error_message": error_message,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_email_domain_provisioning failed: {response.status_code}")


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


def swap_integration_credential(
    settings: IntegrationSettings, *, connection_id: str, expected_refresh_token: str | None, secret: str
) -> bool:
    """Store a rotated credential only if the one on file still holds the refresh token this caller
    renewed from. `False` means someone else rotated first and their pair is the one to keep."""
    return bool(
        _integration_rpc(
            settings,
            "swap_integration_credential",
            {"p_connection_id": connection_id, "p_expected_refresh": expected_refresh_token, "p_secret": secret},
        )
    )


def complete_integration_execution(
    settings: IntegrationSettings,
    *,
    execution_id: str,
    succeeded: bool,
    error_class: str | None = None,
    result_bytes: int | None = None,
    result: object = None,
) -> None:
    payload = {
        "p_execution_id": execution_id,
        "p_succeeded": succeeded,
        "p_error_class": error_class,
        "p_result_bytes": result_bytes,
        "p_result": result,
    }
    _integration_rpc(settings, "complete_integration_execution", payload)


def upsert_mcp_server(settings: IntegrationSettings, *, organization_id: str, connection_id: str, name: str, endpoint: str) -> str:
    return str(
        _integration_rpc(
            settings,
            "upsert_mcp_server",
            {"p_organization_id": organization_id, "p_connection_id": connection_id, "p_name": name, "p_endpoint": endpoint},
        )
    )


def record_mcp_discovery(
    settings: IntegrationSettings,
    *,
    server_id: str,
    ok: bool,
    error: str | None = None,
    protocol_version: str | None = None,
    server_name: str | None = None,
    tools: list[dict] | None = None,
) -> int:
    payload = {
        "p_server_id": server_id,
        "p_ok": ok,
        "p_error": error,
        "p_protocol_version": protocol_version,
        "p_server_name": server_name,
        "p_tools": tools or [],
    }
    return int(_integration_rpc(settings, "record_mcp_discovery", payload) or 0)  # type: ignore[call-overload]


def claim_integration_actions(settings: IntegrationSettings, *, limit: int = 20) -> list[dict]:
    return _integration_rpc(settings, "claim_integration_actions", {"p_limit": limit}) or []  # type: ignore[return-value]


def finish_integration_action(
    settings: IntegrationSettings, *, queue_id: str, outcome: str, detail: str | None = None, retry: bool = False
) -> None:
    payload = {"p_id": queue_id, "p_outcome": outcome, "p_detail": detail, "p_retry": retry}
    _integration_rpc(settings, "finish_integration_action", payload)


def purge_integration_executions(settings: IntegrationSettings) -> int:
    return int(_integration_rpc(settings, "purge_integration_executions", {}) or 0)  # type: ignore[call-overload]


def authorize_automation_tool_call(
    settings: IntegrationSettings, *, rule_id: str, grant_id: str, arguments: dict, resource_value: str | None, correlation: str | None
) -> dict:
    payload = {
        "p_rule_id": rule_id,
        "p_grant_id": grant_id,
        "p_arguments": arguments,
        "p_resource_value": resource_value,
        "p_correlation": correlation,
    }
    return _integration_rpc(settings, "authorize_automation_tool_call", payload)  # type: ignore[return-value]


def granted_tools_for_automation(settings: IntegrationSettings, *, rule_id: str) -> list[dict]:
    return _integration_rpc(settings, "granted_tools_for_automation", {"p_rule_id": rule_id}) or []  # type: ignore[return-value]


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


def record_managed_integration_resource(
    settings: IntegrationSettings,
    *,
    connection_id: str,
    resource_type: str,
    external_id: str,
    display_name: str,
    metadata: dict,
) -> str:
    """Records or corrects one provider-observed resource -- the single-resource sibling of
    `replace_integration_resources`'s bulk resync, for a caller (`app.services.dns`) that ensures
    one record at a time and must never mark every other resource under the connection stale."""
    return _integration_rpc(
        settings,
        "record_managed_integration_resource",
        {
            "p_connection_id": connection_id,
            "p_resource_type": resource_type,
            "p_external_id": external_id,
            "p_display_name": display_name,
            "p_metadata": metadata,
        },
    )  # type: ignore[return-value]


def clear_integration_credential(settings: IntegrationSettings, *, connection_id: str) -> None:
    _integration_rpc(settings, "clear_integration_credential", {"p_connection_id": connection_id})


INVITATION_EMAIL_WEBHOOK_ROLE = "invitation_email_webhook"

# The invitation-email-delivery integration's own auth.users row, fixed in
# 20261102000001_resend_is_a_provider_account_and_invitations_report_delivery.sql. No email, no
# password, like every other webhook actor.
INVITATION_EMAIL_WEBHOOK_ACTOR = "00000000-0000-4000-8000-0000000000a6"


def record_invitation_delivery_event(
    settings: InvitationEmailWebhookSettings,
    *,
    provider_message_id: str,
    state: str,
    detail: str | None,
    payload: dict,
    payload_hash: str,
    event_at: datetime | None = None,
) -> str | None:
    """One Resend callback about one invitation email, applied through `invitation_email_webhook`'s
    one door. Organization and invitation are both derived inside the function from the provider's
    own message id -- never from anything this handler could otherwise have been asked to trust.
    `event_at` is the provider's own timestamp for the event (`app.providers.resend.webhook`'s
    `parse_event`), kept apart from when this platform heard it so a delayed callback cannot
    regress a newer delivery state."""
    token = machine_token(
        settings.supabase_jwt_secret, role=INVITATION_EMAIL_WEBHOOK_ROLE, sub=INVITATION_EMAIL_WEBHOOK_ACTOR
    )

    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/record_invitation_delivery_event",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "p_provider_message_id": provider_message_id,
            "p_state": state,
            "p_detail": detail,
            "p_payload": payload,
            "p_payload_hash": payload_hash,
            "p_event_at": event_at.isoformat() if event_at is not None else None,
        },
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_invitation_delivery_event failed: {response.status_code}")
    return response.json()


# --- a business's own email: the provider's callbacks, and the runtime's answers ---------------------
#
# Two machine roles, two jobs, and no table grant on either. `tenant_email_webhook` is the provider
# calling in (a delivery event, an arriving message, a stored attachment); `provider_operator` is this
# runtime telling the database what the provider answered about a send it has already proved the
# caller may make. Neither can name an organization: the database derives it from what the provider
# itself names.

TENANT_EMAIL_WEBHOOK_ROLE = "tenant_email_webhook"
TENANT_EMAIL_WEBHOOK_ACTOR = "00000000-0000-4000-8000-0000000000a7"


def _webhook_headers(settings) -> dict[str, str]:
    token = machine_token(settings.supabase_jwt_secret, role=TENANT_EMAIL_WEBHOOK_ROLE, sub=TENANT_EMAIL_WEBHOOK_ACTOR)
    return {"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _rpc(settings, headers: dict[str, str], *, function: str, payload: dict) -> object:
    response = httpx.post(f"{settings.supabase_url}/rest/v1/rpc/{function}", headers=headers, json=payload, timeout=15.0)
    if response.status_code >= 400:
        # No body: an error here could echo an argument, and an argument may be a message.
        raise RuntimeError(f"{function} failed: {response.status_code}")
    # A function that returns nothing answers with an empty body, which is a success, not a parse error.
    return response.json() if response.content else None


def record_email_event(
    settings,
    *,
    provider_message_id: str,
    event_type: str,
    provider_event_id: str,
    detail: str | None,
    payload: dict,
    event_at: datetime | None,
) -> str | None:
    """One delivery callback about an email GildOps sent. `None` for a duplicate or an unknown message."""
    return _rpc(  # type: ignore[return-value]
        settings,
        _webhook_headers(settings),
        function="record_email_event",
        payload={
            "p_provider_message_id": provider_message_id,
            "p_event_type": event_type,
            "p_provider_event_id": provider_event_id,
            "p_detail": detail,
            "p_payload": payload,
            "p_event_at": event_at.isoformat() if event_at is not None else None,
        },
    )


def record_inbound_email(
    settings,
    *,
    to_addresses: list[str],
    from_address: str,
    provider_email_id: str,
    provider_event_id: str,
    rfc_message_id: str | None,
    in_reply_to: str | None,
    references: list[str],
    subject: str,
    text: str,
    html: str | None,
    received_at: datetime | None,
    authentication: dict | None,
    attachments: list[dict],
) -> dict | None:
    """A verified inbound email, persisted. The business, the address and the thread are all derived
    inside the function from the address the mail was sent to; `None` when it is not for anyone here."""
    return _rpc(  # type: ignore[return-value]
        settings,
        _webhook_headers(settings),
        function="record_inbound_email",
        payload={
            "p_to_addresses": to_addresses,
            "p_from_address": from_address,
            "p_provider_email_id": provider_email_id,
            "p_provider_event_id": provider_event_id,
            "p_rfc_message_id": rfc_message_id,
            "p_in_reply_to": in_reply_to,
            "p_references": references,
            "p_subject": subject,
            "p_text": text,
            "p_html": html,
            "p_received_at": received_at.isoformat() if received_at is not None else None,
            "p_authentication": authentication,
            "p_attachments": attachments,
        },
    )


def record_inbound_attachment_stored(
    settings,
    *,
    attachment_id: str,
    storage_path: str | None,
    size_bytes: int | None,
    rejection: str | None = None,
) -> None:
    _rpc(
        settings,
        _webhook_headers(settings),
        function="record_inbound_attachment_stored",
        payload={
            "p_attachment_id": attachment_id,
            "p_storage_path": storage_path,
            "p_size_bytes": size_bytes,
            "p_rejection": rejection,
        },
    )


def store_inbound_attachment(settings, *, path: str, content: bytes, content_type: str) -> bool:
    """Put one received attachment in the private bucket under its business's `inbound` folder.

    The webhook role may insert there and nowhere else, and cannot read anything back: a
    compromised handler could add a file to the folder it was given, never open another's.
    """
    token = machine_token(settings.supabase_jwt_secret, role=TENANT_EMAIL_WEBHOOK_ROLE, sub=TENANT_EMAIL_WEBHOOK_ACTOR)
    response = httpx.post(
        f"{settings.supabase_url}/storage/v1/object/communications/{path}",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": content_type or "application/octet-stream"},
        content=content,
        timeout=60.0,
    )
    return response.status_code < 400


def claim_email_for_send(settings: ProviderOperationsSettings, *, organization_id: str, message_id: str) -> bool:
    """Take a queued email for sending, exactly once. False when something else already has it."""
    return bool(
        _rpc(
            settings,
            _provider_headers(settings),
            function="claim_email_for_send",
            payload={"p_organization_id": organization_id, "p_message_id": message_id},
        )
    )


def record_email_send_result(
    settings: ProviderOperationsSettings,
    *,
    organization_id: str,
    message_id: str,
    outcome: str,
    external_id: str | None = None,
    detail: str | None = None,
    rfc_message_id: str | None = None,
) -> None:
    """What the provider answered about one send. The only way an email message ever becomes `sent`."""
    _rpc(
        settings,
        _provider_headers(settings),
        function="record_email_send_result",
        payload={
            "p_organization_id": organization_id,
            "p_message_id": message_id,
            "p_outcome": outcome,
            "p_external_id": external_id,
            "p_detail": detail,
            "p_rfc_message_id": rfc_message_id,
        },
    )


# --- a business's own private value: one role, one door ------------------------------------------

SECRET_ROLE = "secret_operator"

# The secret-resolution integration's own `auth.users` row, fixed in
# 20261126000002_an_organization_stores_a_private_credential_once.sql.
SECRET_RESOLUTION_ACTOR = "00000000-0000-4000-8000-0000000000a9"


def resolve_secret_reference(settings: IntegrationSettings, *, organization_id: str, key: str) -> str | None:
    """A business's stored value, by the name it was stored under, or `None` when it is absent or
    disabled. **The only place in this repository a Secret Reference is read.**

    The caller is a runtime that needs this one value for this one business -- never "all of an
    organization's secrets" and never a Vault id. The failure carries the status and nothing else:
    an error from this call could echo an argument, and no message here may hold a value.
    """
    token = machine_token(settings.supabase_jwt_secret, role=SECRET_ROLE, sub=SECRET_RESOLUTION_ACTOR)
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/resolve_secret_reference",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"p_organization_id": organization_id, "p_key": key},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"resolve_secret_reference failed: {response.status_code}")
    value = response.json() if response.content else None
    return value if isinstance(value, str) else None
