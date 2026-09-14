"""The CRM domain's first command: moving a customer along the pipeline.

What RLS actually decides — a caller `change_customer_stage` cannot authorize, a cross-tenant
customer, the `customer.stage_changed` event — is proven against real Postgres by
`apps/web/tests/reception.test.ts`, calling the same RPC directly. What belongs here is the half
that is a fact about this process: it forwards the caller's own token and mints nothing, it
turns a database refusal into the right one of four error types, and it does not perform the
write itself.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import caller  # noqa: E402
from app.core.config import DomainSettings  # noqa: E402
from app.domains.crm.stages import (  # noqa: E402
    ChangeCustomerStageCommand,
    ChangeCustomerStageResult,
    change_customer_stage,
)
from app.domains.errors import DomainError, NotFoundError, ValidationError  # noqa: E402

SETTINGS = DomainSettings(supabase_url="http://db.test", supabase_publishable_key="anon")
ORG = "11111111-1111-4111-8111-111111111111"
CUSTOMER = "22222222-2222-4222-8222-222222222222"
STAGE = "33333333-3333-4333-8333-333333333333"


def _respond(monkeypatch, *, status: int, body) -> dict:
    """Patch `httpx.post`, and hand back what it was called with."""
    seen: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: A002
        seen["url"] = url
        seen["headers"] = headers
        seen["json"] = json

        class Response:
            status_code = status
            headers = {"content-type": "application/json"}

            @staticmethod
            def json():
                return body

        return Response()

    monkeypatch.setattr(caller.httpx, "post", fake_post)
    return seen


def test_forwards_the_callers_token_and_mints_nothing(monkeypatch) -> None:
    seen = _respond(monkeypatch, status=200, body={"id": CUSTOMER, "stage_id": STAGE})

    change_customer_stage(
        SETTINGS,
        token="the-operators-own",
        command=ChangeCustomerStageCommand(
            organization_id=ORG, customer_id=CUSTOMER, stage_id=STAGE
        ),
    )

    assert seen["headers"]["Authorization"] == "Bearer the-operators-own"
    assert seen["url"] == "http://db.test/rest/v1/rpc/change_customer_stage"
    assert seen["json"] == {
        "p_organization_id": ORG,
        "p_customer_id": CUSTOMER,
        "p_stage_id": STAGE,
    }


def test_answers_with_the_row_the_database_wrote(monkeypatch) -> None:
    _respond(monkeypatch, status=200, body={"id": CUSTOMER, "stage_id": STAGE})

    result = change_customer_stage(
        SETTINGS,
        token="t",
        command=ChangeCustomerStageCommand(
            organization_id=ORG, customer_id=CUSTOMER, stage_id=STAGE
        ),
    )

    assert result == ChangeCustomerStageResult(customer_id=CUSTOMER, stage_id=STAGE)


def test_clearing_a_stage_is_a_real_answer_not_an_omission(monkeypatch) -> None:
    seen = _respond(monkeypatch, status=200, body={"id": CUSTOMER, "stage_id": None})

    result = change_customer_stage(
        SETTINGS,
        token="t",
        command=ChangeCustomerStageCommand(organization_id=ORG, customer_id=CUSTOMER, stage_id=None),
    )

    assert seen["json"]["p_stage_id"] is None
    assert result.stage_id is None


def test_a_customer_the_caller_may_not_touch_is_not_found_not_an_internal_error(monkeypatch) -> None:
    # The schema's own ambiguous refusal (errcode 42501) — a caller able to tell a refusal from
    # an absence has been told the row exists.
    _respond(
        monkeypatch,
        status=400,
        body={"message": "no such customer here, or not yours to change", "code": "42501"},
    )

    try:
        change_customer_stage(
            SETTINGS,
            token="t",
            command=ChangeCustomerStageCommand(
                organization_id=ORG, customer_id=CUSTOMER, stage_id=STAGE
            ),
        )
        raise AssertionError("expected a NotFoundError")
    except NotFoundError:
        pass


def test_a_stage_from_another_business_is_a_validation_error(monkeypatch) -> None:
    # `customers_stage_same_org` is a foreign key (I18) — a stage id belonging to another
    # organization fails it, not RLS.
    _respond(
        monkeypatch,
        status=400,
        body={"message": "insert or update violates foreign key constraint", "code": "23503"},
    )

    try:
        change_customer_stage(
            SETTINGS,
            token="t",
            command=ChangeCustomerStageCommand(
                organization_id=ORG, customer_id=CUSTOMER, stage_id=STAGE
            ),
        )
        raise AssertionError("expected a ValidationError")
    except ValidationError:
        pass


def test_an_unclassified_failure_never_leaks_the_databases_own_words(monkeypatch) -> None:
    _respond(monkeypatch, status=500, body={"message": "connection reset by peer", "code": "08006"})

    try:
        change_customer_stage(
            SETTINGS,
            token="t",
            command=ChangeCustomerStageCommand(
                organization_id=ORG, customer_id=CUSTOMER, stage_id=STAGE
            ),
        )
        raise AssertionError("expected a DomainError")
    except DomainError as failure:
        assert "connection reset" not in str(failure)


def test_a_missing_customer_id_is_refused_before_any_network_call(monkeypatch) -> None:
    called = False

    def fake_post(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("should not have been called")

    monkeypatch.setattr(caller.httpx, "post", fake_post)

    try:
        change_customer_stage(
            SETTINGS,
            token="t",
            command=ChangeCustomerStageCommand(organization_id=ORG, customer_id="", stage_id=STAGE),
        )
        raise AssertionError("expected a DomainError")
    except DomainError:
        pass

    assert not called
