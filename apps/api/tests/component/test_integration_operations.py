"""A tenant's own OAuth connections: who may act, what is stored, what may leave.

What Postgres decides -- that `read_integration_credential` is executable by no signed-in role,
that a planned or private connector cannot be connected, that a business sees only its own
connections -- is proven against a real database by `apps/web/tests/integration/database/integration-credentials.test.ts`.
What belongs here is the half that is a fact about this process, and it is proven once for each
vendor so the contract is shown to hold for two substantially different suites: authorization is
proved before a credential is touched, a refused sign-in creates nothing, a token is rotated
before it is used, and no response carries a credential.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest

from app.auth import CallerContext
from app.core.config import IntegrationSettings
from app.domains.errors import NotFoundError, ValidationError
from app.domains.integrations import operations as ops
from app.domains.integrations.operations import ProviderRefusedError, operate
from app.domains.integrations.state import StateInvalid, sign_state, verify_state

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    state_secret="state-secret",
    redirect_uri="https://app.test/connect/oauth/callback",
)
ORG = "11111111-1111-4111-8111-111111111111"
CONNECTION = "22222222-2222-4222-8222-222222222222"
ALICE = "33333333-3333-4333-8333-333333333333"
MALLORY = "44444444-4444-4444-8444-444444444444"


def caller(user: str = ALICE) -> CallerContext:
    return CallerContext.build(user_id=user, token="caller-token", claims={"role": "authenticated"}, verification_mechanism="jwks")


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)
        self.content = self.text.encode()

    def json(self):
        return self._body


# Everything one vendor is, so the same tests run for both.
VENDORS = {
    "google_workspace": {
        "env": "GOOGLE_OAUTH",
        "authorize": "https://accounts.google.com/",
        "token": "https://oauth2.googleapis.com/token",
        "account_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "account": {"email": "owner@example.test"},
        "resources": {
            "https://www.googleapis.com/calendar/v3/users/me/calendarList": {"items": [{"id": "cal-1", "summary": "Team", "primary": True}]},
            "https://www.googleapis.com/drive/v3/files": {"files": [{"id": "sheet-1", "name": "Leads"}]},
        },
        "types": {"google_calendar", "google_sheet"},
        "revokes": True,
    },
    "microsoft_365": {
        "env": "MICROSOFT_OAUTH",
        "authorize": "https://login.microsoftonline.com/",
        "token": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "account_url": "https://graph.microsoft.com/v1.0/me",
        "account": {"userPrincipalName": "owner@example.test"},
        "resources": {
            "https://graph.microsoft.com/v1.0/me/calendars": {"value": [{"id": "cal-1", "name": "Calendar", "isDefaultCalendar": True}]},
            "https://graph.microsoft.com/v1.0/me/drive/root/search(q='.xlsx')": {"value": [{"id": "wb-1", "name": "Leads.xlsx"}]},
        },
        "types": {"microsoft_calendar", "microsoft_workbook"},
        "revokes": False,
    },
}


class World:
    """One fake network and one fake database, recording what crossed each."""

    def __init__(self, monkeypatch, vendor: dict, *, manage: bool = True) -> None:
        self.vendor = vendor
        self.manage = manage
        self.token_calls: list[dict] = []
        self.token_reply: Response = Response(200, {"access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3600, "scope": "a b"})
        self.upstream: list[str] = []
        self.rest: list[tuple[str, str]] = []
        self.stored: list[str] = []
        self.health: list[dict] = []
        self.resources: list[dict] = []
        self.cleared = 0
        self.held: dict | None = None
        self.reads = 0

        monkeypatch.setenv(f"{vendor['env']}_CLIENT_ID", "client-id")
        monkeypatch.setenv(f"{vendor['env']}_CLIENT_SECRET", "client-secret")
        monkeypatch.setattr(httpx, "request", self._request)
        monkeypatch.setattr(httpx, "post", self._post)
        monkeypatch.setattr(httpx, "get", self._get)
        monkeypatch.setattr(ops.db, "read_integration_credential", self._read)
        monkeypatch.setattr(ops.db, "store_integration_credential", lambda s, *, connection_id, secret: self.stored.append(secret))
        monkeypatch.setattr(ops.db, "record_integration_health", lambda s, **kw: self.health.append(kw))
        monkeypatch.setattr(ops.db, "replace_integration_resources", lambda s, *, connection_id, resources: self.resources.extend(resources))
        monkeypatch.setattr(ops.db, "clear_integration_credential", lambda s, *, connection_id: setattr(self, "cleared", self.cleared + 1))

    # --- database, as the caller (PostgREST) ------------------------------------------------
    def _request(self, method, url, **kwargs):
        path = url.removeprefix("http://db.test/rest/v1/")
        self.rest.append((method, path))
        if path == "rpc/can_manage_integrations":
            return Response(200, self.manage)
        if path == "integration_connections":
            return Response(200, [{"id": CONNECTION, "organization_id": ORG, "connector_key": "google_workspace" if self.vendor["env"].startswith("GOOGLE") else "microsoft_365", "status": "active"}] if self.manage else [])
        if path == "platform_connectors":
            return Response(200, [{"status": "beta"}])
        if path == "rpc/record_integration_connection":
            return Response(200, CONNECTION)
        if path == "rpc/disconnect_integration":
            return Response(200, None)
        raise AssertionError(f"unexpected PostgREST call {path}")

    def _read(self, settings, *, connection_id):
        self.reads += 1
        return {"organization_id": ORG, "status": "active", "secret": json.dumps(self.held)} if self.held else None

    # --- the vendor ------------------------------------------------------------------------
    def _post(self, url, **kwargs):
        self.upstream.append(url)
        if url == self.vendor["token"]:
            self.token_calls.append(kwargs["data"])
            return self.token_reply
        return Response(200, {})

    def _get(self, url, **kwargs):
        self.upstream.append(url)
        if url == self.vendor["account_url"]:
            return Response(200, self.vendor["account"])
        if url in self.vendor["resources"]:
            return Response(200, self.vendor["resources"][url])
        raise AssertionError(f"unexpected vendor call {url}")


@pytest.fixture(params=sorted(VENDORS))
def vendor_key(request):
    return request.param


def world(monkeypatch, vendor_key, **kw) -> World:
    return World(monkeypatch, VENDORS[vendor_key], **kw)


def begun(w: World, vendor_key: str) -> dict:
    return operate(SETTINGS, caller(), operation="begin", arguments={"organization_id": ORG, "connector_key": vendor_key})


# ---------------------------------------------------------------------------------------
# The state
# ---------------------------------------------------------------------------------------


def test_state_is_authentic_and_expires():
    state = sign_state("s", {"org": ORG}, now=1000)
    assert verify_state("s", state, now=1001)["org"] == ORG
    with pytest.raises(StateInvalid):
        verify_state("other-secret", state, now=1001)
    with pytest.raises(StateInvalid):
        verify_state("s", state, now=1000 + 10_000)
    body, signature = state.split(".")
    with pytest.raises(StateInvalid):
        verify_state("s", body + "x." + signature, now=1001)


# ---------------------------------------------------------------------------------------
# begin
# ---------------------------------------------------------------------------------------


def test_begin_builds_the_vendors_authorize_url_with_a_signed_state(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    result = begun(w, vendor_key)

    assert result["url"].startswith(w.vendor["authorize"])
    assert "client_id=client-id" in result["url"]
    assert "client-secret" not in result["url"]
    state = result["url"].split("state=")[1].split("&")[0]
    claims = verify_state(SETTINGS.state_secret, state.replace("%2E", "."))
    assert claims["org"] == ORG and claims["sub"] == ALICE and claims["nonce"] == result["nonce"]
    assert w.reads == 0  # beginning never touches a stored credential


def test_begin_refuses_a_caller_who_cannot_manage_integrations_there(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key, manage=False)
    with pytest.raises(NotFoundError):
        begun(w, vendor_key)
    assert w.upstream == [] and w.reads == 0


def test_begin_is_refused_when_the_deployment_has_no_registration(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    monkeypatch.delenv(f"{w.vendor['env']}_CLIENT_SECRET")
    with pytest.raises(ValidationError):
        begun(w, vendor_key)


# ---------------------------------------------------------------------------------------
# complete
# ---------------------------------------------------------------------------------------


def complete_with(w: World, vendor_key: str, *, user: str = ALICE, nonce: str | None = None, state: str | None = None, code: str = "the-code"):
    started = begun(w, vendor_key)
    url_state = started["url"].split("state=")[1].split("&")[0].replace("%2E", ".")
    w.upstream.clear(); w.rest.clear()
    return operate(
        SETTINGS,
        caller(user),
        operation="complete",
        arguments={"code": code, "state": state or url_state, "nonce": nonce or started["nonce"]},
    )


def test_complete_stores_the_credential_records_health_and_lists_resources(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    result = complete_with(w, vendor_key)

    assert result == {"organization_id": ORG, "connection_id": CONNECTION}
    assert json.loads(w.stored[0])["refresh_token"] == "refresh-1"
    assert w.health[-1]["ok"] is True and w.health[-1]["account_label"] == "owner@example.test"
    assert w.health[-1]["scopes"] == ["a", "b"]
    assert {r["resource_type"] for r in w.resources} == w.vendor["types"]
    assert ("POST", "rpc/record_integration_connection") in w.rest
    assert "client-secret" not in json.dumps(result) and "access-1" not in json.dumps(result)


def test_a_state_from_another_browser_or_person_creates_nothing(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    with pytest.raises(ValidationError):
        complete_with(w, vendor_key, nonce="someone-elses-nonce")
    with pytest.raises(ValidationError):
        complete_with(w, vendor_key, user=MALLORY)
    with pytest.raises(ValidationError):
        complete_with(w, vendor_key, state="forged.state")
    assert w.token_calls == [] and w.stored == []


def test_a_refused_sign_in_creates_no_connection_and_stores_nothing(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.token_reply = Response(400, {"error": "invalid_grant", "error_description": "Code was already redeemed."})
    with pytest.raises(ProviderRefusedError, match="Code was already redeemed"):
        complete_with(w, vendor_key)
    assert w.stored == [] and w.health == []
    assert ("POST", "rpc/record_integration_connection") not in w.rest


def test_a_sign_in_that_cannot_stay_signed_in_is_refused(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.token_reply = Response(200, {"access_token": "access-1", "expires_in": 3600})
    with pytest.raises(ProviderRefusedError):
        complete_with(w, vendor_key)
    assert w.stored == []


# ---------------------------------------------------------------------------------------
# sync: rotation and failure
# ---------------------------------------------------------------------------------------


def held(expires_in: int) -> dict:
    return {"access_token": "old-access", "refresh_token": "old-refresh", "expires_at": int(time.time()) + expires_in}


def test_an_expired_token_is_rotated_before_it_is_used(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(-10)
    w.token_reply = Response(200, {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600})

    result = operate(SETTINGS, caller(), operation="sync", arguments={"connection_id": CONNECTION})

    assert result == {"ok": True, "resources": len(w.vendor["types"])}
    assert w.token_calls[0]["grant_type"] == "refresh_token" and w.token_calls[0]["refresh_token"] == "old-refresh"
    stored = json.loads(w.stored[0])
    assert stored["access_token"] == "new-access" and stored["refresh_token"] == "new-refresh"
    assert w.health[-1]["ok"] is True


def test_a_vendor_that_does_not_rotate_keeps_the_refresh_token_it_had(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(-10)
    w.token_reply = Response(200, {"access_token": "new-access", "expires_in": 3600})
    operate(SETTINGS, caller(), operation="sync", arguments={"connection_id": CONNECTION})
    assert json.loads(w.stored[0])["refresh_token"] == "old-refresh"


def test_a_fresh_token_is_used_as_it_is(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(3600)
    operate(SETTINGS, caller(), operation="sync", arguments={"connection_id": CONNECTION})
    assert w.token_calls == [] and w.stored == []


def test_a_revoked_grant_marks_the_connection_and_says_why(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(-10)
    w.token_reply = Response(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
    with pytest.raises(ProviderRefusedError, match="expired or revoked"):
        operate(SETTINGS, caller(), operation="sync", arguments={"connection_id": CONNECTION})
    assert w.health[-1]["ok"] is False and "expired or revoked" in w.health[-1]["error"]
    assert w.stored == []


def test_a_caller_who_may_not_manage_never_causes_a_credential_to_be_read(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key, manage=False)
    w.held = held(3600)
    with pytest.raises(NotFoundError):
        operate(SETTINGS, caller(MALLORY), operation="sync", arguments={"connection_id": CONNECTION})
    assert w.reads == 0 and w.upstream == []


def test_no_response_carries_a_credential(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(-10)
    w.token_reply = Response(200, {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600})
    results = [
        begun(w, vendor_key),
        operate(SETTINGS, caller(), operation="sync", arguments={"connection_id": CONNECTION}),
    ]
    text = json.dumps(results)
    for secret in ("new-access", "new-refresh", "old-access", "old-refresh", "client-secret"):
        assert secret not in text


# ---------------------------------------------------------------------------------------
# disconnect
# ---------------------------------------------------------------------------------------


def test_disconnect_revokes_where_the_vendor_allows_deletes_the_credential_then_retires(monkeypatch, vendor_key):
    w = world(monkeypatch, vendor_key)
    w.held = held(3600)
    operate(SETTINGS, caller(), operation="disconnect", arguments={"connection_id": CONNECTION})

    revoked = any("revoke" in url for url in w.upstream)
    assert revoked is w.vendor["revokes"]
    assert w.cleared == 1
    assert ("POST", "rpc/disconnect_integration") in w.rest


def test_an_unknown_operation_is_refused(monkeypatch, vendor_key):
    world(monkeypatch, vendor_key)
    with pytest.raises(ValidationError):
        operate(SETTINGS, caller(), operation="read_credential", arguments={})
