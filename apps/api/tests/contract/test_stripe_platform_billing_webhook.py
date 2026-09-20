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
        "items": {"data": [{"price": {"id": "price_1"}}]},
        **overrides,
    }
    return json.dumps({"id": "evt_1", "type": "customer.subscription.updated", "data": {"object": obj}})


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
    assert parsed.price_reference == "price_1"
    assert parsed.status == "active"
    # Upper-cased, because every currency column in this schema is `^[A-Z]{3}$`.
    assert parsed.currency == "CAD"
    assert parsed.current_period_start == 1_700_000_000
    assert parsed.current_period_end == 1_702_600_000
    assert parsed.cancel_at_period_end is False
    assert parsed.canceled_at is None


def test_reads_the_period_from_the_subscription_item_when_absent_on_the_subscription() -> None:
    # The API-version defensiveness the module docstring describes: 2025-03-31 ("basil") and
    # later carry the period on the item, not the subscription.
    body = json.dumps(
        {
            "id": "evt_4",
            "type": "customer.subscription.created",
            "data": {
                "object": {
                    "id": "sub_2",
                    "customer": "cus_2",
                    "status": "trialing",
                    "currency": "usd",
                    "cancel_at_period_end": False,
                    "canceled_at": None,
                    "items": {
                        "data": [
                            {
                                "price": {"id": "price_2"},
                                "current_period_start": 1_690_000_000,
                                "current_period_end": 1_692_600_000,
                            }
                        ]
                    },
                }
            },
        }
    )
    parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)

    assert isinstance(parsed, SubscriptionEvent)
    assert parsed.current_period_start == 1_690_000_000
    assert parsed.current_period_end == 1_692_600_000


def test_a_subscription_missing_a_price_is_unreadable_rather_than_guessed() -> None:
    body = json.dumps(
        {
            "id": "evt_5",
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_3",
                    "customer": "cus_3",
                    "status": "active",
                    "currency": "cad",
                    "items": {"data": []},
                }
            },
        }
    )
    assert parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW) is None


def test_parses_invoice_events_as_notices_only() -> None:
    for event_type in ("invoice.paid", "invoice.payment_failed"):
        body = json.dumps(
            {"id": "evt_6", "type": event_type, "data": {"object": {"id": "in_1", "customer": "cus_1"}}}
        )
        parsed = parse(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)

        assert isinstance(parsed, NoticeEvent)
        assert parsed.event_reference == "evt_6"
        assert parsed.event_type == event_type
        assert parsed.customer_reference == "cus_1"
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
