"""The Stripe handler's signature check and event reading.

Pure and offline, for the reason the module itself gives: there is no SDK and no network, so
what is exercised here is the real code rather than a fake standing in for it.

These do **not** run in `pnpm --filter @gold/web check`. That gate belongs to the web app; run
`python -m pytest apps/api/tests` alongside it. The gap is named in `apps/api/README.md` so
that nobody discovers it by shipping through it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import INTEGRATION_ACTOR, ROLE, machine_token  # noqa: E402
from app.providers.stripe.webhook import settlement, verify_signature  # noqa: E402

SECRET = "whsec_test_secret"
NOW = 1_800_000_000


def sign(body: str, timestamp: int = NOW, key: str = SECRET) -> str:
    digest = hmac.new(key.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_accepts_a_signature_it_can_reproduce() -> None:
    body = json.dumps({"type": "customer.created"})
    assert verify_signature(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)


def test_refuses_another_secret_and_another_body() -> None:
    body = json.dumps({"type": "customer.created"})

    assert not verify_signature(
        body=body,
        signature=sign(body, key="whsec_someone_else"),
        signing_secret=SECRET,
        now=NOW,
    )

    assert not verify_signature(
        body=json.dumps({"type": "customer.created", "tampered": True}),
        signature=sign(body),
        signing_secret=SECRET,
        now=NOW,
    )


def test_refuses_a_replay_and_a_missing_header() -> None:
    body = json.dumps({"type": "customer.created"})

    # The timestamp is inside the signed payload precisely so a replayer cannot move it.
    assert not verify_signature(
        body=body, signature=sign(body), signing_secret=SECRET, now=NOW + 4_000
    )
    assert not verify_signature(body=body, signature=None, signing_secret=SECRET, now=NOW)
    assert not verify_signature(
        body=body, signature="v1=deadbeef", signing_secret=SECRET, now=NOW
    )


def test_throws_rather_than_falling_back_on_a_bad_signature() -> None:
    body = json.dumps({"type": "checkout.session.completed"})
    with pytest.raises(ValueError):
        settlement(body=body, signature="nonsense", signing_secret=SECRET, now=NOW)


def test_reads_only_the_event_it_acts_on() -> None:
    other = json.dumps({"type": "customer.created", "data": {"object": {"id": "cus_1"}}})
    assert settlement(body=other, signature=sign(other), signing_secret=SECRET, now=NOW) is None


def test_takes_nothing_from_the_payload_but_its_own_correlation_token() -> None:
    body = json.dumps(
        {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_1",
                    "client_reference_id": "11111111-1111-4111-8111-111111111111",
                    "amount_total": 12_000,
                    "currency": "cad",
                    # A vendor is authoritative for its own events only. Neither of these is
                    # read, and that is the assertion: Stripe may not tell this platform which
                    # invoice to settle, or which business it belongs to.
                    "metadata": {"invoice_id": "somebody-elses-invoice"},
                    "organization_id": "somebody-elses-org",
                }
            },
        }
    )

    payment = settlement(body=body, signature=sign(body), signing_secret=SECRET, now=NOW)

    assert payment is not None
    assert payment.request_id == "11111111-1111-4111-8111-111111111111"
    assert payment.provider == "stripe"
    assert payment.provider_reference == "cs_test_1"
    assert payment.amount_minor == 12_000
    # Upper-cased, because every currency column in this schema is `^[A-Z]{3}$`.
    assert payment.currency == "CAD"


def test_mints_a_token_naming_its_own_role_and_never_service_role() -> None:
    token = machine_token("a-secret", now=NOW)
    payload = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))

    assert claims["role"] == ROLE
    assert claims["role"] != "service_role"
    # A real auth.users id, which is what keeps I11 in one shape (D26).
    assert claims["sub"] == INTEGRATION_ACTOR
    # Short-lived. Issued per request, stored nowhere.
    assert claims["exp"] - claims["iat"] <= 60
