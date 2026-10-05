"""Communications/Voice's first domain command: writing up how a call went.

What RLS actually decides is proven against real Postgres by `apps/web/tests/integration/database/reception.test.ts`,
calling `record_call_outcome` directly. This file covers the same three facts every domain
command test does: the token is forwarded and nothing is minted, a database refusal becomes the
right one of four error types, and the command performs no write of its own.
"""

from __future__ import annotations

from app.core import caller
from app.core.config import DomainSettings
from app.domains.communications.voice.wrap_up import (
    WrapUpCallCommand,
    WrapUpCallResult,
    wrap_up_call,
)
from app.errors import DomainError, NotFoundError, ValidationError

SETTINGS = DomainSettings(supabase_url="http://db.test", supabase_publishable_key="anon")
ORG = "11111111-1111-4111-8111-111111111111"
CALL = "44444444-4444-4444-8444-444444444444"
OUTCOME = "55555555-5555-4555-8555-555555555555"


def _respond(monkeypatch, *, status: int, body) -> dict:
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
    seen = _respond(
        monkeypatch,
        status=200,
        body={"id": CALL, "customer_id": "c", "outcome_id": OUTCOME, "status": "completed"},
    )

    wrap_up_call(
        SETTINGS,
        token="the-operators-own",
        command=WrapUpCallCommand(
            organization_id=ORG,
            call_id=CALL,
            outcome_id=OUTCOME,
            note="Interested, call back Thursday.",
            duration_seconds=180,
        ),
    )

    assert seen["headers"]["Authorization"] == "Bearer the-operators-own"
    assert seen["url"] == "http://db.test/rest/v1/rpc/record_call_outcome"
    assert seen["json"] == {
        "p_organization_id": ORG,
        "p_call_id": CALL,
        "p_outcome_id": OUTCOME,
        "p_note": "Interested, call back Thursday.",
        "p_duration_seconds": 180,
    }


def test_answers_with_the_row_the_database_wrote(monkeypatch) -> None:
    _respond(
        monkeypatch,
        status=200,
        body={"id": CALL, "customer_id": "c", "outcome_id": OUTCOME, "status": "completed"},
    )

    result = wrap_up_call(
        SETTINGS,
        token="t",
        command=WrapUpCallCommand(
            organization_id=ORG, call_id=CALL, outcome_id=OUTCOME, note="", duration_seconds=None
        ),
    )

    assert result == WrapUpCallResult(call_id=CALL, outcome_id=OUTCOME, status="completed")


def test_a_call_the_caller_may_not_write_up_is_not_found(monkeypatch) -> None:
    _respond(
        monkeypatch,
        status=400,
        body={"message": "that call is not yours to write up", "code": "42501"},
    )

    try:
        wrap_up_call(
            SETTINGS,
            token="t",
            command=WrapUpCallCommand(
                organization_id=ORG, call_id=CALL, outcome_id=None, note="", duration_seconds=None
            ),
        )
        raise AssertionError("expected a NotFoundError")
    except NotFoundError:
        pass


def test_a_negative_duration_is_a_validation_error_not_a_repeated_check(monkeypatch) -> None:
    # `calls.duration_seconds`'s own check constraint (>= 0) is what refuses this — this module
    # does not re-check it, and this test is what proves the database's refusal still translates.
    _respond(
        monkeypatch,
        status=400,
        body={
            "message": 'new row for relation "calls" violates check constraint',
            "code": "23514",
        },
    )

    try:
        wrap_up_call(
            SETTINGS,
            token="t",
            command=WrapUpCallCommand(
                organization_id=ORG,
                call_id=CALL,
                outcome_id=None,
                note="",
                duration_seconds=-5,
            ),
        )
        raise AssertionError("expected a ValidationError")
    except ValidationError:
        pass


def test_an_unclassified_failure_never_leaks_the_databases_own_words(monkeypatch) -> None:
    _respond(monkeypatch, status=503, body={"message": "the database refused (503)", "code": None})

    try:
        wrap_up_call(
            SETTINGS,
            token="t",
            command=WrapUpCallCommand(
                organization_id=ORG, call_id=CALL, outcome_id=None, note="", duration_seconds=None
            ),
        )
        raise AssertionError("expected a DomainError")
    except DomainError as failure:
        assert str(failure) == "That could not be completed."


def test_a_missing_call_id_is_refused_before_any_network_call(monkeypatch) -> None:
    called = False

    def fake_post(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("should not have been called")

    monkeypatch.setattr(caller.httpx, "post", fake_post)

    try:
        wrap_up_call(
            SETTINGS,
            token="t",
            command=WrapUpCallCommand(
                organization_id=ORG, call_id="", outcome_id=None, note="", duration_seconds=None
            ),
        )
        raise AssertionError("expected a DomainError")
    except DomainError:
        pass

    assert not called
