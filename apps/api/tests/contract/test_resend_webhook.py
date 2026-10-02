"""Resend's own Svix-shaped signature, verified before anything in the body is trusted.

`invitation_email_webhook.py`'s own wiring (that the handler calls this before recording anything)
is `test_handlers.py`'s subject; this proves the verification itself: every header, a tampered
body, a stale timestamp, a secret that does not match, and the event-to-state mapping.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone

import pytest

from app.providers.resend.webhook import SignatureInvalid, parse_event, verify_signature

SECRET = "whsec_" + base64.b64encode(b"a" * 24).decode()
NOW = 1_700_000_000


def sign(body: bytes, *, secret: str = SECRET, svix_id: str = "msg_1", timestamp: int = NOW) -> dict[str, str]:
    key = base64.b64decode(secret.removeprefix("whsec_"))
    content = f"{svix_id}.{timestamp}.{body.decode()}".encode()
    signature = base64.b64encode(hmac.new(key, content, hashlib.sha256).digest()).decode()
    return {"svix_id": svix_id, "svix_timestamp": str(timestamp), "svix_signature": f"v1,{signature}"}


def test_a_correctly_signed_callback_verifies() -> None:
    body = json.dumps({"type": "email.delivered"}).encode()
    verify_signature(secret=SECRET, body=body, now=NOW, **sign(body))


def test_any_missing_header_is_refused() -> None:
    body = b"{}"
    full = sign(body)
    for missing in full:
        kwargs = {**full, missing: None}
        with pytest.raises(SignatureInvalid):
            verify_signature(secret=SECRET, body=body, now=NOW, **kwargs)


def test_a_tampered_body_is_refused() -> None:
    body = json.dumps({"type": "email.delivered"}).encode()
    headers = sign(body)
    with pytest.raises(SignatureInvalid):
        verify_signature(secret=SECRET, body=b'{"type":"email.bounced"}', now=NOW, **headers)


def test_a_signature_from_a_different_secret_is_refused() -> None:
    body = b'{"type":"email.sent"}'
    headers = sign(body, secret="whsec_" + base64.b64encode(b"b" * 24).decode())
    with pytest.raises(SignatureInvalid):
        verify_signature(secret=SECRET, body=body, now=NOW, **headers)


def test_a_stale_timestamp_is_refused_even_with_a_correct_signature() -> None:
    body = b'{"type":"email.sent"}'
    headers = sign(body, timestamp=NOW - 400)
    with pytest.raises(SignatureInvalid):
        verify_signature(secret=SECRET, body=body, now=NOW, **headers)


def test_a_timestamp_just_inside_tolerance_is_accepted() -> None:
    body = b'{"type":"email.sent"}'
    headers = sign(body, timestamp=NOW - 290)
    verify_signature(secret=SECRET, body=body, now=NOW, **headers)


def test_a_malformed_timestamp_is_refused() -> None:
    body = b'{"type":"email.sent"}'
    with pytest.raises(SignatureInvalid):
        verify_signature(secret=SECRET, body=body, now=NOW, svix_id="x", svix_timestamp="not-a-number", svix_signature="v1,abc")


# --- event mapping ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("event_type", "state"),
    [
        ("email.sent", "sent"),
        ("email.delivered", "delivered"),
        ("email.delivery_delayed", "delayed"),
        ("email.bounced", "bounced"),
        ("email.failed", "failed"),
        ("email.suppressed", "suppressed"),
    ],
)
def test_every_tracked_event_type_maps_to_golds_own_state(event_type, state) -> None:
    event = parse_event({"type": event_type, "created_at": "2026-01-02T03:04:05.000Z", "data": {"email_id": "m1"}})
    assert event["message_id"] == "m1"
    assert event["state"] == state
    assert event["event_at"] == datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


# Nested detail paths confirmed against Resend's own documented example payload for each event
# (resend.com/docs/webhooks/emails/<event>) -- never a flat `data.reason`, which is not the shape
# any of these events actually use.


def test_a_bounce_carries_the_providers_own_bounce_message() -> None:
    event = parse_event({"type": "email.bounced", "data": {"email_id": "m1", "bounce": {"message": "mailbox full", "type": "Permanent"}}})
    assert event["detail"] == "mailbox full"


def test_a_failure_carries_the_providers_own_reason() -> None:
    event = parse_event({"type": "email.failed", "data": {"email_id": "m1", "failed": {"reason": "reached_daily_quota"}}})
    assert event["detail"] == "reached_daily_quota"


def test_a_suppression_carries_the_providers_own_message() -> None:
    event = parse_event({"type": "email.suppressed", "data": {"email_id": "m1", "suppressed": {"message": "on the account-level suppression list"}}})
    assert event["detail"] == "on the account-level suppression list"


def test_delivery_delayed_and_sent_and_delivered_carry_no_detail_today() -> None:
    for event_type in ("email.sent", "email.delivered", "email.delivery_delayed"):
        event = parse_event({"type": event_type, "data": {"email_id": "m1"}})
        assert event["detail"] is None


def test_a_flat_reason_field_outside_the_documented_nested_shape_is_not_read() -> None:
    # A bounce with the detail in the wrong place (the old, incorrect assumption) must not leak
    # through as if it were the real bounce.message.
    event = parse_event({"type": "email.bounced", "data": {"email_id": "m1", "reason": "mailbox full"}})
    assert event["detail"] is None


def test_an_untracked_event_type_is_ignored_not_refused() -> None:
    assert parse_event({"type": "email.clicked", "data": {"email_id": "m1"}}) is None


def test_a_missing_or_malformed_created_at_leaves_event_at_null() -> None:
    assert parse_event({"type": "email.sent", "data": {"email_id": "m1"}})["event_at"] is None
    assert parse_event({"type": "email.sent", "created_at": "not a date", "data": {"email_id": "m1"}})["event_at"] is None


def test_an_event_with_no_message_id_is_ignored() -> None:
    assert parse_event({"type": "email.delivered", "data": {}}) is None


def test_a_non_object_body_is_ignored() -> None:
    assert parse_event([1, 2, 3]) is None
    assert parse_event("not an object") is None
