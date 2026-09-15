"""GOLD's own billing account calling in about a subscription -- never the tenant-Connect webhook.

**Two Stripe destinations, two handlers, and this is the second one.** `webhook.py` (this
package) verifies `checkout.session.completed` for a *tenant's customer paying the tenant*
through a connected account. This module verifies subscription-lifecycle events from *GOLD's own
Stripe account*, about *an organization paying GOLD* -- the opposite money direction
(`domain-model.md`'s two-plane table). It reuses `verify_signature` from `webhook.py` because the
HMAC scheme is the same vendor mechanism either way, and stops there: the events handled, the
Postgres role, the signing secret and the `auth.users` actor are all distinct.

**Which events, and why only these.** Checked against current Stripe guidance
(docs.stripe.com/billing/subscriptions/webhooks) rather than assumed: `customer.subscription.*`
is what actually carries subscription status, and `invoice.paid`/`invoice.payment_failed` are
logged for the idempotency ledger and platform diagnostics only -- Stripe's own docs state a
`customer.subscription.updated` event already accompanies the status transition either invoice
event causes ("Catch subscription status changes"), so there is exactly one writer of `status`
rather than two independently-derived opinions about it. `checkout.session.completed` is
deliberately **not** subscribed here: subscription lifecycle is fully covered by the events above,
resolved by the processor's own customer reference (already on file from provisioning) rather
than a session id -- and the browser's return from Checkout is not payment proof in any case
(Phase 7).
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.integrations.stripe.webhook import verify_signature

SUBSCRIPTION_EVENTS = {
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
}
NOTICE_EVENTS = {
    "invoice.paid",
    "invoice.payment_failed",
}
HANDLED = SUBSCRIPTION_EVENTS | NOTICE_EVENTS


@dataclass(frozen=True)
class SubscriptionEvent:
    """A `customer.subscription.*` event, thinned to what `apply_platform_subscription_event` needs."""

    event_reference: str
    event_type: str
    customer_reference: str
    subscription_reference: str
    price_reference: str
    status: str
    currency: str
    current_period_start: int | None
    current_period_end: int | None
    cancel_at_period_end: bool
    canceled_at: int | None


@dataclass(frozen=True)
class NoticeEvent:
    """`invoice.paid` / `invoice.payment_failed` -- ledger-only, see the module docstring."""

    event_reference: str
    event_type: str
    customer_reference: str


def parse(
    *, body: str, signature: str | None, signing_secret: str, now: int
) -> SubscriptionEvent | NoticeEvent | None:
    """Turn a signed callback into a typed event, or None for one this handler does not act on.

    Raises when the signature does not check out -- the caller must not distinguish that from
    any other failure, and must never fall back to trusting the body (the same discipline
    `webhook.py::settlement` already holds).
    """
    if not verify_signature(
        body=body, signature=signature, signing_secret=signing_secret, now=now
    ):
        raise ValueError("that callback did not come from stripe")

    event = json.loads(body)
    event_type = event.get("type")
    event_reference = event.get("id")
    if not isinstance(event_reference, str) or event_type not in HANDLED:
        return None

    obj = (event.get("data") or {}).get("object") or {}
    customer_reference = obj.get("customer")
    if not isinstance(customer_reference, str):
        return None

    if event_type in NOTICE_EVENTS:
        return NoticeEvent(
            event_reference=event_reference,
            event_type=event_type,
            customer_reference=customer_reference,
        )

    subscription_reference = obj.get("id")
    status = obj.get("status")
    currency = obj.get("currency")

    items = ((obj.get("items") or {}).get("data")) or []
    price_reference = None
    # Stripe API versions from 2025-03-31 ("basil") onward carry the billing period on the
    # subscription *item* rather than the subscription itself; earlier versions carry both on
    # the subscription. Reading defensively from either location, rather than pinning one
    # `Stripe-Version`, is what keeps this correct across that change without this repository
    # naming a specific API version anywhere (matching every other Stripe touchpoint here).
    period_start = obj.get("current_period_start")
    period_end = obj.get("current_period_end")
    if items:
        price = items[0].get("price") or {}
        price_reference = price.get("id")
        if period_start is None:
            period_start = items[0].get("current_period_start")
        if period_end is None:
            period_end = items[0].get("current_period_end")

    if not all(
        isinstance(v, str) for v in (subscription_reference, status, currency, price_reference)
    ):
        return None

    return SubscriptionEvent(
        event_reference=event_reference,
        event_type=event_type,
        customer_reference=customer_reference,
        subscription_reference=subscription_reference,
        price_reference=price_reference,
        status=status,
        # Stripe lower-cases currency codes; every currency column in this schema is `^[A-Z]{3}$`.
        currency=currency.upper(),
        current_period_start=period_start if isinstance(period_start, int) else None,
        current_period_end=period_end if isinstance(period_end, int) else None,
        cancel_at_period_end=bool(obj.get("cancel_at_period_end")),
        canceled_at=obj.get("canceled_at") if isinstance(obj.get("canceled_at"), int) else None,
    )
