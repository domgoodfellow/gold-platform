"""Acting on a GOLD-owned provider account: who may ask, and what may leave.

What Postgres decides -- that `read_provider_account_credential` is executable by no signed-in
role, and that `record_provider_account_verification` is not either -- is proven against a real
database by `apps/web/tests/provider-accounts.test.ts`. What belongs here is the half that is a
fact about this process: authorization is proved before the credential is read, a refused caller
never reaches a vendor, a verification is recorded by this runtime, and no response carries the
credential.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.core.config import ProviderOperationsSettings  # noqa: E402
from app.domains.errors import NotFoundError, ValidationError  # noqa: E402
from app.domains.providers import operations as ops  # noqa: E402
from app.domains.providers.operations import OperateCommand, ProviderRefusedError, operate  # noqa: E402
from app.providers.twilio import accounts as twilio  # noqa: E402

SETTINGS = ProviderOperationsSettings(
    supabase_url="http://db.test", supabase_publishable_key="anon", supabase_jwt_secret="signing"
)
ACCOUNT = "44444444-4444-4444-8444-444444444444"
SECRET = "the-parent-credential"
CREDENTIAL = {
    "provider_key": "twilio",
    "external_account_id": "AC" + "a" * 32,
    "credential_kind": "api_key",
    "credential_identifier": "SK" + "b" * 32,
    "secret": SECRET,
}


class _Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _as(monkeypatch, *, staff: bool, credential=CREDENTIAL, recorded=None, upstream=None):
    """`httpx` is one module, so one fake `get` answers both the staff check and the vendor."""

    def get(url, **kwargs):
        if url.startswith("http://db.test"):
            return _Response(200, [{"id": ACCOUNT}] if staff else [])
        if upstream is None:
            pytest.fail("no upstream call expected")
        return upstream(url, **kwargs)

    monkeypatch.setattr(ops.httpx, "get", get)
    reads: list[str] = []

    def read(settings, *, account_id):
        reads.append(account_id)
        return credential

    monkeypatch.setattr(ops, "read_provider_account_credential", read)
    monkeypatch.setattr(
        ops,
        "record_provider_account_verification",
        lambda settings, **kw: (recorded if recorded is not None else []).append(kw),
    )
    return reads


def test_a_caller_who_is_not_staff_never_causes_the_credential_to_be_read(monkeypatch) -> None:
    reads = _as(monkeypatch, staff=False)

    with pytest.raises(NotFoundError):
        operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "verify", {}))

    assert reads == []


def test_an_unknown_operation_is_refused_before_any_upstream_call(monkeypatch) -> None:
    _as(monkeypatch, staff=True)

    with pytest.raises(ValidationError):
        operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "delete_everything", {}))


def test_an_account_with_no_usable_credential_is_a_validation_refusal(monkeypatch) -> None:
    _as(monkeypatch, staff=True, credential=None)

    with pytest.raises(ValidationError):
        operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "verify", {}))


def test_a_working_parent_is_recorded_verified_and_the_result_carries_no_secret(monkeypatch) -> None:
    recorded: list[dict] = []
    seen: dict = {}

    def upstream(url, auth=None, params=None, timeout=None):
        seen["auth"] = auth
        return _Response(
            200,
            {"status": "active", "friendly_name": "GOLD", "type": "Full", "owner_account_sid": CREDENTIAL["external_account_id"]},
        )

    _as(monkeypatch, staff=True, recorded=recorded, upstream=upstream)

    result = operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "verify", {}))

    assert result["ok"] is True
    assert SECRET not in str(result)
    # An API key authenticates as itself, not as the account.
    assert seen["auth"] == (CREDENTIAL["credential_identifier"], SECRET)
    assert recorded == [{"account_id": ACCOUNT, "ok": True, "error": None, "metadata": result["metadata"]}]


def test_a_refused_credential_is_recorded_failed_with_the_providers_own_words(monkeypatch) -> None:
    recorded: list[dict] = []
    _as(monkeypatch, staff=True, recorded=recorded, upstream=lambda url, **k: _Response(401, "Authenticate"))

    result = operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "verify", {}))

    assert result["ok"] is False
    assert "401" in result["error"] and "Authenticate" in result["error"]
    assert recorded[0]["ok"] is False
    assert SECRET not in str(recorded)


def test_a_subaccount_is_not_accepted_as_a_parent(monkeypatch) -> None:
    recorded: list[dict] = []
    _as(
        monkeypatch,
        staff=True,
        recorded=recorded,
        upstream=lambda url, **k: _Response(200, {"status": "active", "owner_account_sid": "AC" + "c" * 32}),
    )

    result = operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "verify", {}))

    assert result["ok"] is False
    assert "subaccount" in result["error"]


def test_listing_follows_pages_and_leaves_out_the_parent(monkeypatch) -> None:
    parent = CREDENTIAL["external_account_id"]
    pages = [
        {"accounts": [{"sid": parent}, {"sid": "ACone", "friendly_name": "gold-org-1", "status": "active"}], "next_page_uri": "/2010-04-01/Accounts.json?Page=1"},
        {"accounts": [{"sid": "ACtwo", "friendly_name": "other", "status": "suspended"}]},
    ]
    _as(monkeypatch, staff=True, upstream=lambda url, **k: _Response(200, pages.pop(0)))

    result = operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "list_subaccounts", {}))

    assert [row["sid"] for row in result["subaccounts"]] == ["ACone", "ACtwo"]


def test_an_upstream_refusal_on_a_write_is_a_502_not_an_internal_error(monkeypatch) -> None:
    _as(monkeypatch, staff=True)
    monkeypatch.setattr(twilio.httpx, "post", lambda *a, **k: _Response(403, "not permitted"))

    with pytest.raises(ProviderRefusedError) as raised:
        operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "create_subaccount", {"friendly_name": "x"}))

    assert raised.value.status == 502


def test_a_missing_argument_is_a_validation_refusal(monkeypatch) -> None:
    _as(monkeypatch, staff=True)

    with pytest.raises(ValidationError):
        operate(SETTINGS, token="t", command=OperateCommand(ACCOUNT, "create_api_key", {}))


def test_the_domain_module_names_no_vendor() -> None:
    source = Path(ops.__file__).read_text(encoding="utf-8").lower()
    assert "twilio" not in source.replace("app.providers", "")
