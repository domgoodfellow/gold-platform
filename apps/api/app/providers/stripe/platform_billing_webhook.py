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
is what actually carries subscription status, and the invoice events never write it -- Stripe's
own docs state a `customer.subscription.updated` event already accompanies the status transition
an invoice event causes ("Catch subscription status changes"), so there is exactly one writer of
`status`. What the invoice events carry instead is the invoice itself: `invoice.finalized`,
`invoice.paid`, `invoice.payment_failed`, `invoice.voided` and `invoice.marked_uncollectible`
become the invoice in GildOps' Finance (ADR-057), with its lines, total and payment, and
`charge.refunded` records a refund against the invoice the charge paid. `checkout.session.completed` is
deliberately **not** subscribed here: subscription lifecycle is fully covered by the events above,
resolved by the processor's own customer reference (already on file from provisioning) rather
than a session id -- and the browser's return from Checkout is not payment proof in any case
(Phase 7).
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.providers.stripe.webhook import verify_signature

SUBSCRIPTION_EVENTS = {
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
}
INVOICE_EVENTS = {
    "invoice.finalized",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "invoice.marked_uncollectible",
}
REFUND_EVENTS = {"charge.refunded"}
HANDLED = SUBSCRIPTION_EVENTS | INVOICE_EVENTS | REFUND_EVENTS


@dataclass(frozen=True)
class SubscriptionItemEvent:
    """One recurring item on the provider's subscription, exactly as the provider reports it.

    `quantity` is `None` when the provider reports none (a metered price) -- never defaulted to 1.
    The period is this item's own; the provider may or may not give every item the same one.
    """

    item_reference: str
    price_reference: str
    quantity: int | None
    current_period_start: int | None
    current_period_end: int | None


@dataclass(frozen=True)
class SubscriptionEvent:
    """A `customer.subscription.*` event, thinned to what `apply_platform_subscription_event` needs.

    `current_period_*` are the *subscription-level* period only, absent on newer API versions; each
    item carries its own. `provider_event_created_at` is the provider's occurrence time, which is
    what orders events -- GildOps's receipt time orders nothing. `checkout_correlation` is the
    opaque id GildOps put on the subscription at checkout; it is correlation, never authorization.
    """

    event_reference: str
    event_type: str
    customer_reference: str
    environment: str
    subscription_reference: str
    status: str
    currency: str
    current_period_start: int | None
    current_period_end: int | None
    cancel_at_period_end: bool
    canceled_at: int | None
    provider_event_created_at: int
    items: tuple[SubscriptionItemEvent, ...]
    checkout_correlation: str | None

    @property
    def item_payload(self) -> list[dict[str, object]]:
        """The bounded JSON shape `apply_platform_subscription_event` takes as `p_items`."""
        return [
            {
                "item_reference": item.item_reference,
                "price_reference": item.price_reference,
                "quantity": item.quantity,
                "current_period_start": item.current_period_start,
                "current_period_end": item.current_period_end,
            }
            for item in self.items
        ]


# The metadata key GildOps writes onto the provider subscription at checkout. Provider vocabulary
# stays here: the database and the domain only ever see "checkout correlation".
CHECKOUT_CORRELATION_KEY = "gildops_checkout_session_id"


@dataclass(frozen=True)
class InvoiceEvent:
    """An invoice the provider issued, paid, voided or refunded, thinned to what
    `apply_platform_invoice_event` needs as `p_invoice`. Amounts are the provider's own minor
    units; times are the provider's own Unix seconds. Never a subscription-status writer."""

    event_reference: str
    event_type: str
    customer_reference: str
    environment: str
    invoice: dict[str, object]


def _int(value: object) -> int | None:
    # `bool` is an `int` in Python; a provider `true` is not an amount.
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _invoice_payload(obj: dict[str, object], created: int | None) -> dict[str, object] | None:
    """The provider invoice in the bounded shape the database reads, or None when it lacks an id or
    a currency, or any line lacks an amount -- a partial invoice is not recorded as a whole one."""
    invoice_id = obj.get("id")
    currency = obj.get("currency")
    if not isinstance(invoice_id, str) or not isinstance(currency, str):
        return None
    lines: list[dict[str, object]] = []
    starts: list[int] = []
    ends: list[int] = []
    for raw in ((obj.get("lines") or {}).get("data") or []) if isinstance(obj.get("lines"), dict) else []:
        if not isinstance(raw, dict) or _int(raw.get("amount")) is None:
            return None
        period = raw.get("period") if isinstance(raw.get("period"), dict) else {}
        if _int(period.get("start")) is not None:
            starts.append(period["start"])
        if _int(period.get("end")) is not None:
            ends.append(period["end"])
        lines.append({
            "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
            "amount": raw["amount"],
            "quantity": _int(raw.get("quantity")) or 1,
        })
    # Tax: a single figure on older API versions, a list of amounts on newer ones.
    tax = _int(obj.get("tax"))
    if tax is None and isinstance(obj.get("total_taxes"), list):
        tax = sum(_int(entry.get("amount")) or 0 for entry in obj["total_taxes"] if isinstance(entry, dict))
    transitions = obj.get("status_transitions") if isinstance(obj.get("status_transitions"), dict) else {}
    payment = obj.get("payment_intent") or obj.get("charge")
    return {
        "id": invoice_id,
        "number": obj.get("number") if isinstance(obj.get("number"), str) else None,
        "status": obj.get("status") if isinstance(obj.get("status"), str) else None,
        # Stripe lower-cases currency codes; every currency column in this schema is `^[A-Z]{3}$`.
        "currency": currency.upper(),
        "created": _int(obj.get("created")),
        "finalized_at": _int(transitions.get("finalized_at")),
        "paid_at": _int(transitions.get("paid_at")),
        "due_date": _int(obj.get("due_date")),
        # The service period the lines bill, else the invoice's own.
        "period_start": min(starts) if starts else _int(obj.get("period_start")),
        "period_end": max(ends) if ends else _int(obj.get("period_end")),
        "hosted_invoice_url": obj.get("hosted_invoice_url") if isinstance(obj.get("hosted_invoice_url"), str) else None,
        "total": _int(obj.get("total")),
        "tax": tax or 0,
        "amount_paid": _int(obj.get("amount_paid")) or 0,
        "payment_reference": payment if isinstance(payment, str) else None,
        "lines": lines,
        "refunds": [],
        "event_created": created,
    }


def _refund_payload(obj: dict[str, object], created: int | None) -> dict[str, object] | None:
    """A refunded charge, as the refunds against the invoice it paid. Without the invoice the
    charge paid there is nothing in Finance to record it against, so the event is not acted on."""
    invoice_id = obj.get("invoice")
    currency = obj.get("currency")
    if not isinstance(invoice_id, str) or not isinstance(currency, str):
        return None
    refunds = []
    for raw in ((obj.get("refunds") or {}).get("data") or []) if isinstance(obj.get("refunds"), dict) else []:
        if isinstance(raw, dict) and isinstance(raw.get("id"), str) and _int(raw.get("amount")):
            refunds.append({"id": raw["id"], "amount": raw["amount"], "created": _int(raw.get("created"))})
    if not refunds:
        return None
    return {"id": invoice_id, "currency": currency.upper(), "status": None, "refunds": refunds, "lines": [], "event_created": created}


def parse(
    *, body: str, signature: str | None, signing_secret: str, now: int
) -> SubscriptionEvent | InvoiceEvent | None:
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

    # Which environment the signed event came from decides which customer it can be about. Without
    # the provider's own flag there is no honest way to choose, so the event is not acted on.
    livemode = event.get("livemode")
    if not isinstance(livemode, bool):
        return None
    environment = "live" if livemode else "sandbox"

    if event_type in INVOICE_EVENTS or event_type in REFUND_EVENTS:
        occurred = _int(event.get("created"))
        payload = _invoice_payload(obj, occurred) if event_type in INVOICE_EVENTS else _refund_payload(obj, occurred)
        if payload is None:
            return None
        return InvoiceEvent(
            event_reference=event_reference,
            event_type=event_type,
            customer_reference=customer_reference,
            environment=environment,
            invoice=payload,
        )

    subscription_reference = obj.get("id")
    status = obj.get("status")
    currency = obj.get("currency")

    created = event.get("created")
    raw_items = ((obj.get("items") or {}).get("data")) or []

    # Every recurring item, never `items[0]`: checkout now buys a base Plan and Add-ons together, so
    # a subscription is several items and none of them is the subscription's identity. An item the
    # provider listed without its own id or price is not guessed at -- and neither is the event
    # applied, because a partial item set would read as the omitted items having been removed.
    # (A one-time checkout line is never a subscription item, so there is nothing to fabricate.)
    items: list[SubscriptionItemEvent] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            return None
        price = raw.get("price") or {}
        item_reference = raw.get("id")
        price_reference = price.get("id") if isinstance(price, dict) else None
        if not isinstance(item_reference, str) or not isinstance(price_reference, str):
            return None
        quantity = raw.get("quantity")
        start = raw.get("current_period_start")
        end = raw.get("current_period_end")
        items.append(
            SubscriptionItemEvent(
                item_reference=item_reference,
                price_reference=price_reference,
                # `bool` is an `int` in Python; a provider `true` is not a quantity of one.
                quantity=quantity if isinstance(quantity, int) and not isinstance(quantity, bool) else None,
                current_period_start=start if isinstance(start, int) else None,
                current_period_end=end if isinstance(end, int) else None,
            )
        )

    # Without the provider's own occurrence time there is no honest way to order the event, and
    # receipt time is not a substitute for it.
    if (
        not items
        or not isinstance(created, int)
        or isinstance(created, bool)
        or not all(isinstance(v, str) for v in (subscription_reference, status, currency))
    ):
        return None

    # Stripe API versions from 2025-03-31 ("basil") onward carry the billing period on the
    # subscription *item* rather than the subscription itself; earlier versions carry it on the
    # subscription. Both are kept: the subscription-level period here, each item's own on the item.
    # Which item anchors the parent's billing period is the database's decision (the base Plan's),
    # because only the database can tell a base Plan from an Add-on.
    period_start = obj.get("current_period_start")
    period_end = obj.get("current_period_end")

    metadata = obj.get("metadata")
    correlation = metadata.get(CHECKOUT_CORRELATION_KEY) if isinstance(metadata, dict) else None

    return SubscriptionEvent(
        event_reference=event_reference,
        event_type=event_type,
        customer_reference=customer_reference,
        environment=environment,
        subscription_reference=subscription_reference,
        status=status,
        # Stripe lower-cases currency codes; every currency column in this schema is `^[A-Z]{3}$`.
        currency=currency.upper(),
        current_period_start=period_start if isinstance(period_start, int) else None,
        current_period_end=period_end if isinstance(period_end, int) else None,
        cancel_at_period_end=bool(obj.get("cancel_at_period_end")),
        canceled_at=obj.get("canceled_at") if isinstance(obj.get("canceled_at"), int) else None,
        provider_event_created_at=created,
        items=tuple(items),
        checkout_correlation=correlation if isinstance(correlation, str) and correlation.strip() else None,
    )
