"""The GOLD-platform-billing handler's signature check and event reading.

Pure and offline, the same reasoning `test_stripe_webhook.py` gives: no SDK, no network, so what
is exercised here is the real code rather than a fake standing in for it.

Mirrors `test_stripe_webhook.py`'s shape deliberately — the two webhooks share one HMAC
implementation (`verify_signature`) and this file's job is to prove the two remain otherwise
separate: a different event vocabulary, a different Postgres role, a different actor.

These do **not** run in `pnpm --filter @gold/web check`. That gate belongs to the web app; run
`python -m pytest apps/api/tests` alongside it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest

from app.core.db import (
    PLATFORM_BILLING_ACTOR,
    PLATFORM_BILLING_ROLE,
    ROLE,
    machine_token,
)
from app.providers.stripe.platform_billing_webhook import (
    NoticeEvent,
    SubscriptionEvent,
    parse,
)

SECRET = "whsec_platform_billing_test_secret"
NOW = 1_800_000_000


def sign(body: str, timestamp: int = NOW, key: str = SECRET) -> str:
    digest = hmac.new(key.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def subscription_body(**overrides: object) -> str:
    obj = {
        "id": "sub_1",
        "customer": "cus_1",
        "status": "active",
        "currency": "cad",
        "current_period_start": 1_700_000_000,
        "current_period_end": 1_702_600_000,
        "cancel_at_period_end": False,
        "canceled_at": None,
        "items": {"data": [item("si_1", "price_1")]},
        **overrides,
    }
    return json.dumps(
        {
            "id": "evt_1",
            "type": "customer.subscription.updated",
            "created": 1_750_000_000,
            "livemode": False,
            "data": {"object": obj},
        }
    )


def item(item_id: str, price_id: str, **fields: object) -> dict[str, object]:
    return {"id": item_id, "price": {"id": price_id}, "quantity": 1, **fields}


def test_accepts_a_signature_it_can_reproduce() -> None:
    body = subscription_body()
    parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)
    assert isinstance(parsed, SubscriptionEvent)


def test_refuses_another_secret_and_a_tampered_body() -> None:
    body = subscription_body()

    with pytest.raises(ValueError):
        parse(body=body, signature=sign(body, key="whsec_someone_else"), signing_secret=SECRET, now=NOW)

    tampered = subscription_body(status="canceled")
    with pytest.raises(ValueError):
        parse(body=tampered, signature=sign(body), signing_secret=SECRET, now=NOW)


def test_refuses_a_replay_and_a_missing_header() -> None:
    body = subscription_body()

    with pytest.raises(ValueError):
        parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW + 4_000)
    with pytest.raises(ValueError):
        parse(body=body, signature=None, signing_secret=SECRET, now=NOW)


def test_throws_rather_than_falling_back_on_a_bad_signature() -> None:
    body = subscription_body()
    with pytest.raises(ValueError):
        parse(body=body, signature="nonsense", signing_secret=SECRET, now=NOW)


def test_reads_only_the_events_it_acts_on() -> None:
    other = json.dumps(
        {"id": "evt_2", "type": "customer.created", "data": {"object": {"id": "cus_1"}}}
    )
    assert parse(body=other, signature=sign(other), signing_secret=SECRET, now=NOW) is None


def test_does_not_subscribe_to_checkout_session_completed() -> None:
    # Deliberately not one of ours (module docstring) -- subscription lifecycle is fully covered
    # by customer.subscription.* and invoice.*, resolved by customer reference.
    body = json.dumps(
        {
            "id": "evt_3",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_1", "customer": "cus_1"}},
        }
    )
    assert parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW) is None


def test_parses_a_subscription_created_event() -> None:
    body = subscription_body()
    parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)

    assert isinstance(parsed, SubscriptionEvent)
    assert parsed.event_reference == "evt_1"
    assert parsed.customer_reference == "cus_1"
    assert parsed.subscription_reference == "sub_1"
    assert [(i.item_reference, i.price_reference, i.quantity) for i in parsed.items] == [("si_1", "price_1", 1)]
    assert parsed.provider_event_created_at == 1_750_000_000
    assert parsed.checkout_correlation is None
    assert parsed.status == "active"
    # Upper-cased, because every currency column in this schema is `^[A-Z]{3}$`.
    assert parsed.currency == "CAD"
    assert parsed.current_period_start == 1_700_000_000
    assert parsed.current_period_end == 1_702_600_000
    assert parsed.cancel_at_period_end is False
    assert parsed.canceled_at is None


def parse_body(body: str) -> SubscriptionEvent:
    parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)
    assert isinstance(parsed, SubscriptionEvent)
    return parsed


def test_keeps_each_items_own_period_and_never_borrows_the_first_items_for_the_subscription() -> None:
    # The API-version defensiveness the module docstring describes: 2025-03-31 ("basil") and
    # later carry the period on the item, not the subscription. Which item anchors the parent's
    # billing period is the database's decision, so the parser reports the subscription-level
    # period as absent rather than lifting `items[0]`'s into it.
    body = subscription_body(
        current_period_start=None,
        current_period_end=None,
        items={
            "data": [
                item("si_base", "price_base", current_period_start=1_690_000_000, current_period_end=1_692_600_000),
                item("si_addon", "price_addon", current_period_start=1_691_000_000, current_period_end=1_693_600_000),
            ]
        },
    )
    parsed = parse_body(body)

    assert parsed.current_period_start is None
    assert parsed.current_period_end is None
    assert [(i.item_reference, i.current_period_start, i.current_period_end) for i in parsed.items] == [
        ("si_base", 1_690_000_000, 1_692_600_000),
        ("si_addon", 1_691_000_000, 1_693_600_000),
    ]


def test_reads_every_recurring_item_not_just_the_first() -> None:
    body = subscription_body(
        items={"data": [item("si_a", "price_a"), item("si_b", "price_b"), item("si_c", "price_c")]}
    )
    parsed = parse_body(body)

    assert [i.item_reference for i in parsed.items] == ["si_a", "si_b", "si_c"]
    assert [i.price_reference for i in parsed.items] == ["price_a", "price_b", "price_c"]
    assert parsed.item_payload[1] == {
        "item_reference": "si_b",
        "price_reference": "price_b",
        "quantity": 1,
        "current_period_start": None,
        "current_period_end": None,
    }


def test_retains_the_quantity_the_provider_reports_and_never_defaults_one() -> None:
    body = subscription_body(
        items={"data": [item("si_a", "price_a", quantity=3), {"id": "si_m", "price": {"id": "price_m"}}]}
    )
    parsed = parse_body(body)

    assert [i.quantity for i in parsed.items] == [3, None]


def test_reads_the_checkout_correlation_from_the_subscription_metadata() -> None:
    body = subscription_body(metadata={"gildops_checkout_session_id": "8c3f0a52-0000-4000-8000-000000000001"})
    assert parse_body(body).checkout_correlation == "8c3f0a52-0000-4000-8000-000000000001"

    for absent in ({}, {"gildops_checkout_session_id": ""}, {"gildops_checkout_session_id": 7}, None):
        assert parse_body(subscription_body(metadata=absent)).checkout_correlation is None


def test_does_not_fabricate_an_item_for_a_one_time_checkout_line() -> None:
    # Checkout in subscription mode also bills a one-time line on the first invoice; the provider
    # does not list it as a subscription item, and nothing here may invent one.
    body = subscription_body(items={"data": [item("si_base", "price_base")]})
    parsed = parse_body(body)

    assert [i.price_reference for i in parsed.items] == ["price_base"]


def test_a_malformed_or_missing_item_is_unreadable_rather_than_guessed() -> None:
    cases = [
        {"data": []},
        {"data": [{"id": "si_x", "price": {}}]},
        {"data": [{"price": {"id": "price_x"}}]},
        {"data": [item("si_ok", "price_ok"), {"id": "si_bad"}]},
        {"data": ["not an object"]},
    ]
    for items in cases:
        body = subscription_body(items=items)
        assert parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW) is None


def test_an_event_without_the_providers_occurrence_time_cannot_be_ordered_and_is_unreadable() -> None:
    event = json.loads(subscription_body())
    del event["created"]
    body = json.dumps(event)

    assert parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW) is None


def test_reads_the_environment_from_the_signed_livemode_flag() -> None:
    sandbox = subscription_body()
    parsed = parse(body=sandbox, signature=sign(sandbox), signing_secret=SECRET, now=NOW)
    assert isinstance(parsed, SubscriptionEvent)
    assert parsed.environment == "sandbox"

    event = json.loads(subscription_body())
    event["livemode"] = True
    live = json.dumps(event)
    parsed = parse(body=live, signature=sign(live), signing_secret=SECRET, now=NOW)
    assert isinstance(parsed, SubscriptionEvent)
    assert parsed.environment == "live"


def test_an_event_without_a_readable_livemode_flag_is_about_no_environment_and_is_not_acted_on() -> None:
    for livemode in (None, "true", 1):
        event = json.loads(subscription_body())
        if livemode is None:
            del event["livemode"]
        else:
            event["livemode"] = livemode
        body = json.dumps(event)
        assert parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW) is None

    notice = json.dumps({"id": "evt_7", "type": "invoice.paid", "data": {"object": {"id": "in_1", "customer": "cus_1"}}})
    assert parse(body=notice, signature=sign(notice), signing_secret=SECRET, now=NOW) is None


def test_parses_invoice_events_as_notices_only() -> None:
    for event_type in ("invoice.paid", "invoice.payment_failed"):
        body = json.dumps(
            {"id": "evt_6", "type": event_type, "livemode": True, "data": {"object": {"id": "in_1", "customer": "cus_1"}}}
        )
        parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)

        assert isinstance(parsed, NoticeEvent)
        assert parsed.event_reference == "evt_6"
        assert parsed.event_type == event_type
        assert parsed.customer_reference == "cus_1"
        assert parsed.environment == "live"
        # A notice carries no status, no subscription, no price -- it is not a subscription
        # writer (module docstring).
        assert not hasattr(parsed, "status")


def test_mints_a_token_naming_its_own_role_and_never_service_role_or_the_payment_roles_role() -> None:
    token = machine_token("a-secret", role=PLATFORM_BILLING_ROLE, sub=PLATFORM_BILLING_ACTOR, now=NOW)
    payload = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))

    assert claims["role"] == PLATFORM_BILLING_ROLE
    assert claims["role"] != "service_role"
    assert claims["role"] != ROLE  # never the tenant-payment webhook's role
    assert claims["sub"] == PLATFORM_BILLING_ACTOR
    assert claims["exp"] - claims["iat"] <= 60
