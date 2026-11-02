"""Creating an organization's customer on GOLD's own billing account, and who may record it.

What is real: the route handler, `ensure_billing_customer`'s ordering, the database call shapes
in `app.core.db` and the processor request in `app.providers.stripe.platform_billing_customers`.
What is faked: the network. Each test records every outbound request, so the property under test
is visible as an order -- the person's own permission is proved before the processor is asked, and
only the provisioner's machine token ever records what the processor returned.

The database's own refusals (a human session executing finalization, a claimed reference, an
overwrite) are proved against PostgreSQL in apps/web's `platform-billing.test.ts`.
"""

from __future__ import annotations

import base64
import email.message
import io
import json
from types import SimpleNamespace

import httpx
import pytest

import api.platform_billing_customer as route
from app.core.config import PlatformBillingProvisioningSettings
from app.errors import ConflictError, NotFoundError, ValidationError
from app.services.platform_billing.customers import (
    BillingProviderRefusedError,
    EnsureCustomerCommand,
    ensure_billing_customer,
)

ORG = "3f0c2a56-8a52-4c39-9a3e-0f6c3a1b2d4e"
CALLER = "7d1e9b2c-1111-4b6a-8c3d-2e5f6a7b8c9d"
SANDBOX = PlatformBillingProvisioningSettings(
    supabase_url="https://project.supabase.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    stripe_secret_key="sk_test_fixture",
)
LIVE = PlatformBillingProvisioningSettings(
    supabase_url="https://project.supabase.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    stripe_secret_key="sk_live_fixture",
)


def claims(authorization: str) -> dict:
    payload = authorization.removeprefix("Bearer ").split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


class Network:
    """Answers each outbound request from a script and remembers every one, in order."""

    def __init__(self, monkeypatch, answers: dict[str, list[httpx.Response]]) -> None:
        self.calls: list[tuple[str, dict, object]] = []
        self.answers = answers
        monkeypatch.setattr(httpx, "post", self.post)

    def post(self, url: str, *, headers: dict, json: object = None, data: object = None, timeout: float = 0) -> httpx.Response:
        name = url.rsplit("/", 1)[-1]
        self.calls.append((name, headers, json if json is not None else data))
        queue = self.answers.get(name) or []
        if not queue:
            raise AssertionError(f"unexpected request: {url}")
        return queue.pop(0)

    def names(self) -> list[str]:
        return [name for name, _, _ in self.calls]


def ok(body: object) -> httpx.Response:
    return httpx.Response(200, json=body)


def refused(sqlstate: str, status: int = 400) -> httpx.Response:
    return httpx.Response(status, json={"code": sqlstate, "message": "refused"})


def ensure(settings=SANDBOX, **command):
    return ensure_billing_customer(
        settings,
        token="the-callers-token",
        caller_id=CALLER,
        command=EnsureCustomerCommand(organization_id=command.get("organization_id", ORG), email="owner@business.test", name="Business"),
    )


class TestTheTrustedFlow:
    def test_reserves_as_the_person_then_asks_the_processor_then_records_as_the_provisioner(self, monkeypatch) -> None:
        net = Network(monkeypatch, {
            "begin_platform_billing_customer": [ok({"customer_reference": "pending:abc", "finalized": False})],
            "customers": [ok({"id": "cus_Created123"})],
            "finalize_platform_billing_customer": [ok("cus_Created123")],
        })

        assert ensure() == {"customer_reference": "cus_Created123", "environment": "sandbox"}
        assert net.names() == ["begin_platform_billing_customer", "customers", "finalize_platform_billing_customer"]

        _, begin_headers, begin_body = net.calls[0]
        assert begin_headers["Authorization"] == "Bearer the-callers-token"
        assert begin_body == {"p_organization_id": ORG, "p_environment": "sandbox", "p_provider": "stripe"}

        _, stripe_headers, stripe_form = net.calls[1]
        assert stripe_headers["Authorization"] == "Bearer sk_test_fixture"
        assert stripe_headers["Idempotency-Key"] == f"platform-billing-customer:{ORG}:pending:abc"
        assert stripe_form["metadata[organization_id]"] == ORG

        _, finalize_headers, finalize_body = net.calls[2]
        token = claims(finalize_headers["Authorization"])
        assert token["role"] == "platform_billing_provisioner"
        assert token["sub"] == "00000000-0000-4000-8000-0000000000b2"
        assert finalize_body == {
            "p_organization_id": ORG,
            "p_environment": "sandbox",
            "p_provider": "stripe",
            "p_pending_reference": "pending:abc",
            "p_customer_reference": "cus_Created123",
            "p_requested_by": CALLER,
        }

    def test_takes_the_environment_from_its_own_key_never_from_the_request(self, monkeypatch) -> None:
        net = Network(monkeypatch, {"begin_platform_billing_customer": [ok({"customer_reference": "cus_Live1", "finalized": True})]})
        assert ensure(LIVE)["environment"] == "live"
        assert net.calls[0][2]["p_environment"] == "live"

    def test_returns_an_already_finalized_customer_without_asking_the_processor(self, monkeypatch) -> None:
        net = Network(monkeypatch, {"begin_platform_billing_customer": [ok({"customer_reference": "cus_Existing", "finalized": True})]})
        assert ensure()["customer_reference"] == "cus_Existing"
        assert net.names() == ["begin_platform_billing_customer"]


class TestRefusals:
    def test_a_person_who_may_not_manage_billing_never_reaches_the_processor(self, monkeypatch) -> None:
        net = Network(monkeypatch, {"begin_platform_billing_customer": [refused("42501", 403)]})
        with pytest.raises(NotFoundError):
            ensure()
        assert net.names() == ["begin_platform_billing_customer"]

    def test_a_malformed_business_is_refused_before_any_request(self, monkeypatch) -> None:
        net = Network(monkeypatch, {})
        with pytest.raises(ValidationError):
            ensure(organization_id="not-a-business")
        assert net.calls == []

    def test_a_processor_refusal_records_nothing_and_keeps_the_reservation(self, monkeypatch) -> None:
        net = Network(monkeypatch, {
            "begin_platform_billing_customer": [ok({"customer_reference": "pending:abc", "finalized": False})],
            "customers": [httpx.Response(500, json={})],
        })
        with pytest.raises(BillingProviderRefusedError):
            ensure()
        assert "finalize_platform_billing_customer" not in net.names()

    @pytest.mark.parametrize("answer", [{"id": "pending:forged"}, {"id": "acct_123"}, {}, {"id": 5}])
    def test_an_answer_that_is_not_a_customer_is_never_recorded(self, monkeypatch, answer) -> None:
        net = Network(monkeypatch, {
            "begin_platform_billing_customer": [ok({"customer_reference": "pending:abc", "finalized": False})],
            "customers": [ok(answer)],
        })
        with pytest.raises(BillingProviderRefusedError):
            ensure()
        assert "finalize_platform_billing_customer" not in net.names()


class TestConcurrency:
    def test_a_request_that_loses_the_race_returns_the_winners_customer(self, monkeypatch) -> None:
        net = Network(monkeypatch, {
            "begin_platform_billing_customer": [
                ok({"customer_reference": "pending:abc", "finalized": False}),
                ok({"customer_reference": "cus_Winner", "finalized": True}),
            ],
            "customers": [ok({"id": "cus_Loser"})],
            "finalize_platform_billing_customer": [refused("55000", 409)],
        })
        assert ensure()["customer_reference"] == "cus_Winner"
        assert net.names() == [
            "begin_platform_billing_customer", "customers", "finalize_platform_billing_customer", "begin_platform_billing_customer",
        ]

    def test_a_reference_another_business_holds_is_a_refusal_never_a_guess(self, monkeypatch) -> None:
        Network(monkeypatch, {
            "begin_platform_billing_customer": [
                ok({"customer_reference": "pending:abc", "finalized": False}),
                ok({"customer_reference": "pending:abc", "finalized": False}),
            ],
            "customers": [ok({"id": "cus_Someone"})],
            "finalize_platform_billing_customer": [refused("23505", 409)],
        })
        with pytest.raises(ConflictError):
            ensure()


def call(body: bytes, headers: dict[str, str] | None = None):
    instance = route.handler.__new__(route.handler)
    instance.headers = email.message.Message()
    for key, value in {"content-length": str(len(body)), **(headers or {})}.items():
        instance.headers[key] = value
    instance.rfile = io.BytesIO(body)
    instance.wfile = io.BytesIO()
    status: list[int] = []
    instance.send_response = lambda code, message=None: status.append(code)
    instance.send_header = lambda *args: None
    instance.end_headers = lambda: None
    instance.do_POST()
    return status[0], json.loads(instance.wfile.getvalue() or b"{}")


class TestTheRoute:
    # A missing deployment (404) and a missing or bad token (401, nothing reached) are driven for
    # this handler with every other signed-in endpoint in `test_handlers.py`.

    def test_the_verified_caller_not_the_body_is_who_the_request_is_for(self, monkeypatch) -> None:
        monkeypatch.setattr(route, "load_platform_billing_provisioning_settings", lambda: SANDBOX)
        monkeypatch.setattr(route, "require_caller", lambda headers, **kw: SimpleNamespace(token="verified", user_id=CALLER))
        seen: list[dict] = []
        monkeypatch.setattr(route, "ensure_billing_customer", lambda settings, **kw: seen.append(kw) or {"customer_reference": "cus_X", "environment": "sandbox"})
        body = json.dumps({"organization_id": ORG, "requested_by": "someone-else", "customer_reference": "cus_Forged", "environment": "live"}).encode()

        status, answer = call(body, {"authorization": "Bearer verified"})

        assert status == 200 and answer == {"customer_reference": "cus_X", "environment": "sandbox"}
        assert seen[0]["caller_id"] == CALLER and seen[0]["token"] == "verified"
        assert seen[0]["command"].organization_id == ORG
        assert not hasattr(seen[0]["command"], "customer_reference")
