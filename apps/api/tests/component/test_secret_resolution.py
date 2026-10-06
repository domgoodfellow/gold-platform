"""The one place a business's stored value is read back, and what it may and may not carry.

What Postgres decides -- that only `secret_operator` may execute the door, and that a disabled or
deleted value answers null -- is proven against a real database by
`apps/web/tests/integration/database/secret-references.test.ts`. This is the half that is a fact
about this process: which role it wears, what it sends, and that a failure says nothing about the
value.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.core import db
from app.core.config import IntegrationSettings

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing-secret-for-the-test-0123456789",
    state_secret="state-secret",
    redirect_uri="https://app.test/cb",
)
ORG = "11111111-1111-4111-8111-111111111111"
APP = Path(__file__).resolve().parents[2] / "app"


class Reply:
    def __init__(self, status: int, body) -> None:
        self.status_code, self._body = status, body
        self.content = json.dumps(body).encode()

    def json(self):
        return self._body


def _claims(token: str) -> dict:
    import base64

    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def test_it_wears_the_secret_role_and_sends_only_the_business_and_the_name(monkeypatch):
    seen: dict = {}

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        return Reply(200, "the-value")

    monkeypatch.setattr(httpx, "post", post)

    assert db.resolve_secret_reference(SETTINGS, organization_id=ORG, key="PARTNER_API_KEY") == "the-value"

    assert seen["url"] == "http://db.test/rest/v1/rpc/resolve_secret_reference"
    assert seen["json"] == {"p_organization_id": ORG, "p_key": "PARTNER_API_KEY"}
    claims = _claims(seen["headers"]["Authorization"].removeprefix("Bearer "))
    assert claims["role"] == "secret_operator"
    assert claims["sub"] == db.SECRET_RESOLUTION_ACTOR
    assert claims["exp"] - claims["iat"] <= 120  # a short-lived machine token


def test_an_absent_or_disabled_value_is_none_not_an_empty_string(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda url, **kw: Reply(200, None))
    assert db.resolve_secret_reference(SETTINGS, organization_id=ORG, key="MISSING") is None


def test_a_failure_carries_a_status_and_never_a_value(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda url, **kw: Reply(403, {"message": "leaked-detail sk-live-123"}))
    with pytest.raises(RuntimeError) as failure:
        db.resolve_secret_reference(SETTINGS, organization_id=ORG, key="PARTNER_API_KEY")
    assert "403" in str(failure.value)
    assert "sk-live" not in str(failure.value) and "leaked-detail" not in str(failure.value)


def test_no_other_module_reads_a_secret_reference():
    """The reader is one function, in one module. A second one is a second way to decrypt."""
    offenders = [
        str(path.relative_to(APP))
        for path in APP.rglob("*.py")
        if path.name != "db.py" and "resolve_secret_reference" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
