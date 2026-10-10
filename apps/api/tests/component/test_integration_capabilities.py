"""What a connection can do once connected: declared capabilities and the `invoke` operation.

The network and the database are substituted (the vendors' answers are canned, from their documented
shapes), so this proves what is a fact about this process: only declared operations run, a caller who
cannot manage the connection reaches nothing, a caller's value never becomes a path segment, a token
is renewed before use, and one refused operation does not rewrite the connection's health. It does not
prove a live vendor account answers; that needs real credentials and is reported separately.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest

from app.auth import CallerContext
from app.connectors import oauth_provider_for, registered_connector_keys
from app.core.config import IntegrationSettings
from app.errors import NotFoundError, ValidationError
from app.services.integrations import operations as ops
from app.services.integrations.operations import ProviderRefusedError, operate

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    state_secret="state-secret",
    redirect_uri="https://app.test/connect/oauth/callback",
)
ORG = "11111111-1111-4111-8111-111111111111"
CONNECTION = "22222222-2222-4222-8222-222222222222"
WORKSPACES = {"crm", "communications", "marketing", "support", "finance", "ai", "automations", "field", "studio", "library"}


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body
        self.headers: dict = {}
        self.text = json.dumps(body)
        self.content = self.text.encode()

    def json(self):
        return self._body


# connector, capability, params, URL the vendor must receive, vendor answer, expected result
CASES = [
    ("google_workspace", "calendar.events.list", {"calendar_id": "team@x.test"}, "/calendars/team%40x.test/events",
     {"items": [{"id": "e1", "summary": "Visit", "start": {"dateTime": "t"}, "end": {"dateTime": "u"}, "status": "confirmed", "secret": "x"}]},
     {"events": [{"id": "e1", "title": "Visit", "start": {"dateTime": "t"}, "end": {"dateTime": "u"}, "status": "confirmed"}]}),
    ("google_workspace", "drive.files.list", {"name_contains": "it's"}, "/drive/v3/files",
     {"files": [{"id": "f1", "name": "Plan"}]}, {"files": [{"id": "f1", "name": "Plan"}]}),
    ("google_workspace", "sheets.values.get", {"spreadsheet_id": "s1", "range": "A1:B2"}, "/spreadsheets/s1/values/A1%3AB2",
     {"range": "Sheet1!A1:B2", "values": [["a", "b"]]}, {"range": "Sheet1!A1:B2", "values": [["a", "b"]]}),
    ("microsoft_365", "calendar.events.list", {}, "/me/events",
     {"value": [{"id": "e1", "subject": "Visit", "start": {}, "end": {}, "isCancelled": True}]},
     {"events": [{"id": "e1", "title": "Visit", "start": {}, "end": {}, "status": "cancelled"}]}),
    ("microsoft_365", "onedrive.files.list", {"folder_id": "fo1"}, "/me/drive/items/fo1/children",
     {"value": [{"id": "i1", "name": "A.xlsx", "size": 3, "lastModifiedDateTime": "t", "file": {}}]},
     {"files": [{"id": "i1", "name": "A.xlsx", "size": 3, "modified": "t", "is_folder": False}]}),
    ("microsoft_365", "excel.range.get", {"workbook_id": "w1"}, "/me/drive/items/w1/workbook/worksheets/Sheet1/range(address='A1%3AZ100')",
     {"address": "Sheet1!A1:Z100", "values": [[1]]}, {"address": "Sheet1!A1:Z100", "values": [[1]]}),
    ("hubspot", "crm.contacts.list", {}, "/crm/v3/objects/contacts",
     {"results": [{"id": "1", "properties": {"email": "a@x.test"}}], "paging": {"next": {"after": "9"}}},
     {"results": [{"id": "1", "email": "a@x.test"}], "next_cursor": "9"}),
    ("hubspot", "crm.companies.list", {}, "/crm/v3/objects/companies", {"results": []}, {"results": [], "next_cursor": None}),
    ("hubspot", "crm.deals.list", {}, "/crm/v3/objects/deals", {"results": []}, {"results": [], "next_cursor": None}),
    ("hubspot", "crm.pipelines.list", {}, "/crm/v3/pipelines/deals",
     {"results": [{"id": "p", "label": "Sales", "stages": [{"id": "s", "label": "Won"}]}]},
     {"pipelines": [{"id": "p", "label": "Sales", "stages": [{"id": "s", "label": "Won"}]}]}),
    ("notion", "notion.search", {"query": "plan"}, "/v1/search",
     {"results": [{"id": "n1", "object": "page", "url": "u", "last_edited_time": "t"}]},
     {"results": [{"id": "n1", "type": "page", "url": "u", "last_edited": "t"}]}),
    ("notion", "notion.database.query", {"database_id": "d1"}, "/v1/databases/d1/query",
     {"results": [{"id": "r1", "properties": {}}], "next_cursor": None}, {"results": [{"id": "r1", "properties": {}}], "next_cursor": None}),
    ("notion", "notion.page.get", {"page_id": "p1"}, "/v1/pages/p1", {"id": "p1", "url": "u", "properties": {}}, {"id": "p1", "url": "u", "properties": {}}),
    ("slack", "slack.channels.list", {}, "/api/conversations.list",
     {"ok": True, "channels": [{"id": "C1", "name": "ops"}]}, {"channels": [{"id": "C1", "name": "#ops"}]}),
    ("slack", "slack.messages.history", {"channel_id": "C1"}, "/api/conversations.history",
     {"ok": True, "messages": [{"ts": "1", "user": "U", "text": "hi", "bot_profile": {}}]}, {"messages": [{"ts": "1", "user": "U", "text": "hi"}]}),
    ("dropbox", "dropbox.files.list", {}, "/2/files/list_folder",
     {"entries": [{"id": "id:1", ".tag": "file", "name": "a", "path_lower": "/a", "size": 1}], "has_more": False},
     {"entries": [{"id": "id:1", "name": "a", "kind": "file", "path": "/a", "size": 1}], "has_more": False}),
    ("dropbox", "dropbox.files.metadata", {"path": "/a"}, "/2/files/get_metadata",
     {"id": "id:1", ".tag": "file", "name": "a", "size": 1, "server_modified": "t"},
     {"id": "id:1", "name": "a", "kind": "file", "size": 1, "modified": "t"}),
    ("cloudflare", "cloudflare.zones.list", {}, "/client/v4/zones",
     {"success": True, "result": [{"id": "z1", "name": "x.test", "status": "active"}], "result_info": {"total_pages": 1}},
     {"zones": [{"id": "z1", "name": "x.test", "status": "active"}]}),
    ("cloudflare", "cloudflare.dns.records.list", {"zone_id": "z1"}, "/client/v4/zones/z1/dns_records",
     {"success": True, "result": [{"id": "r", "type": "A", "name": "x.test", "content": "1.1.1.1", "ttl": 1, "proxied": True, "zone_id": "hide"}]},
     {"records": [{"id": "r", "type": "A", "name": "x.test", "content": "1.1.1.1", "ttl": 1, "proxied": True}]}),
    ("github", "github.repositories.list", {}, "/installation/repositories",
     {"repositories": [{"id": 1, "full_name": "o/r", "name": "r", "owner": {"login": "o"}, "default_branch": "main", "private": True}]},
     {"repositories": [{"id": "1", "full_name": "o/r", "owner": "o", "name": "r", "default_branch": "main", "visibility": "private", "archived": False, "url": None}]}),
    ("github", "github.issues.list", {"owner": "o", "repo": "r"}, "/repos/o/r/issues",
     [{"number": 1, "title": "Bug", "state": "open", "html_url": "u"}, {"number": 2, "title": "PR", "pull_request": {}}],
     {"issues": [{"number": 1, "title": "Bug", "state": "open", "url": "u"}]}),
    ("github", "github.commits.list", {"owner": "o", "repo": "r"}, "/repos/o/r/commits",
     [{"sha": "abc", "commit": {"message": "Fix\n\nbody", "author": {"date": "t"}}}],
     {"commits": [{"sha": "abc", "message": "Fix", "date": "t"}]}),
]

PREFIXES = {
    "google_workspace": "GOOGLE_OAUTH", "microsoft_365": "MICROSOFT_OAUTH", "hubspot": "HUBSPOT_OAUTH", "notion": "NOTION_OAUTH",
    "slack": "SLACK_OAUTH", "dropbox": "DROPBOX_OAUTH", "cloudflare": "CLOUDFLARE_OAUTH", "github": "GITHUB_APP",
}


def caller() -> CallerContext:
    return CallerContext.build(user_id="33333333-3333-4333-8333-333333333333", token="caller-token", claims={"role": "authenticated"}, verification_mechanism="jwks")


class World:
    def __init__(self, monkeypatch, connector: str, *, manage: bool = True, answer=None, status: int = 200, held: dict | None = None) -> None:
        self.manage, self.answer, self.status = manage, answer, status
        self.vendor_calls: list[tuple[str, dict]] = []
        self.stored: list[str] = []
        self.health: list[dict] = []
        self.held = held if held is not None else {"access_token": "access-1", "refresh_token": "refresh-1", "expires_at": int(time.time()) + 3600}
        self.connector = connector

        for key, prefix in PREFIXES.items():
            monkeypatch.setenv(f"{prefix}_CLIENT_ID", "client-id")
            monkeypatch.setenv(f"{prefix}_CLIENT_SECRET", "client-secret")
        for name in ("GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY"):
            monkeypatch.setenv(name, "x")
        monkeypatch.setattr(httpx, "request", self._rest_or_vendor)
        monkeypatch.setattr(httpx, "get", lambda url, **kw: self._vendor(url, kw))
        monkeypatch.setattr(httpx, "post", self._post)
        monkeypatch.setattr(ops.db, "read_integration_credential", lambda s, *, connection_id: {"secret": json.dumps(self.held)})
        monkeypatch.setattr(ops.db, "store_integration_credential", lambda s, *, connection_id, secret: self.stored.append(secret))
        monkeypatch.setattr(ops.db, "swap_integration_credential", lambda s, *, connection_id, expected_refresh_token, secret: self.stored.append(secret) or True)
        monkeypatch.setattr(ops.db, "record_integration_health", lambda s, **kw: self.health.append(kw))

    def _rest_or_vendor(self, method, url, **kwargs):
        if url.startswith("http://db.test/rest/v1/"):
            path = url.removeprefix("http://db.test/rest/v1/")
            if path == "rpc/can_manage_integrations":
                return Response(200, self.manage)
            if path == "integration_connections":
                return Response(200, [{"id": CONNECTION, "organization_id": ORG, "connector_key": self.connector, "status": "active"}] if self.manage else [])
            raise AssertionError(f"unexpected PostgREST call {path}")
        return self._vendor(url, kwargs)

    def _post(self, url, **kwargs):
        if "oauth" in url and "token" in url:
            return Response(200, {"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600})
        return self._vendor(url, kwargs)

    def _vendor(self, url, kwargs):
        self.vendor_calls.append((url, kwargs))
        return Response(self.status, self.answer)


def invoke(w: World, capability: str, params: dict | None = None):
    return operate(SETTINGS, caller(), operation="invoke", arguments={"connection_id": CONNECTION, "capability": capability, "params": params or {}})


def test_every_connector_declares_well_formed_capabilities():
    for key in registered_connector_keys():
        provider = oauth_provider_for(key)
        keys = [c.key for c in provider.capabilities]
        assert keys and len(keys) == len(set(keys)), key
        for c in provider.capabilities:
            assert callable(getattr(provider, c.handler)), (key, c.key)
            assert c.workspace in WORKSPACES, (key, c.key)
            assert c.writes is False, "no write operation is implemented, so none may be declared"


def test_every_declared_capability_has_a_test_case():
    tested = {(c, k) for c, k, *_ in CASES}
    declared = {(key, c.key) for key in registered_connector_keys() for c in oauth_provider_for(key).capabilities}
    assert declared == tested


@pytest.mark.parametrize("connector,capability,params,url_part,answer,expected", CASES, ids=[f"{c}:{k}" for c, k, *_ in CASES])
def test_a_capability_calls_the_vendor_and_returns_only_the_normalised_data(monkeypatch, connector, capability, params, url_part, answer, expected):
    w = World(monkeypatch, connector, answer=answer)
    result = invoke(w, capability, params)

    assert result == {"capability": capability, "data": expected}
    assert any(url_part in url for url, _ in w.vendor_calls), [u for u, _ in w.vendor_calls]
    assert all(kw.get("headers", {}).get("Authorization") == "Bearer access-1" for _, kw in w.vendor_calls)
    assert "access-1" not in json.dumps(result)
    assert w.health == [] and w.stored == []  # a working call proves one operation, not the connection


def test_a_caller_who_cannot_manage_the_connection_reaches_nothing(monkeypatch):
    w = World(monkeypatch, "hubspot", manage=False, answer={"results": []})
    with pytest.raises(NotFoundError):
        invoke(w, "crm.contacts.list")
    assert w.vendor_calls == []


def test_an_undeclared_capability_is_refused_before_any_request(monkeypatch):
    w = World(monkeypatch, "hubspot", answer={})
    with pytest.raises(ValidationError):
        invoke(w, "calendar.events.list")  # Google's, not HubSpot's
    with pytest.raises(ValidationError):
        invoke(w, "")
    assert w.vendor_calls == []


def test_a_value_cannot_add_a_path_segment(monkeypatch):
    w = World(monkeypatch, "cloudflare", answer={"success": True, "result": []})
    invoke(w, "cloudflare.dns.records.list", {"zone_id": "../../user/tokens"})
    url = w.vendor_calls[0][0]
    assert url == "https://api.cloudflare.com/client/v4/zones/..%2F..%2Fuser%2Ftokens/dns_records"


def test_missing_input_is_a_validation_error_and_not_a_vendor_failure(monkeypatch):
    w = World(monkeypatch, "notion", answer={})
    with pytest.raises(ValidationError, match="database_id"):
        invoke(w, "notion.database.query")
    assert w.vendor_calls == [] and w.health == []


def test_inputs_are_checked_against_the_declared_schema(monkeypatch):
    w = World(monkeypatch, "hubspot", answer={"results": []})
    with pytest.raises(ValidationError, match="too large"):
        invoke(w, "crm.contacts.list", {"limit": 100000})
    with pytest.raises(ValidationError, match="not an input"):
        invoke(w, "crm.contacts.list", {"path": "/etc/passwd"})
    assert w.vendor_calls == []


def test_a_handler_bounds_its_own_limit_even_when_called_directly(monkeypatch):
    w = World(monkeypatch, "hubspot", answer={"results": []})
    oauth_provider_for("hubspot").invoke("crm.contacts.list", "token", {"limit": 100000})
    assert w.vendor_calls[0][1]["params"]["limit"] == "100"


def test_an_expiring_token_is_renewed_and_stored_before_the_call(monkeypatch):
    held = {"access_token": "old", "refresh_token": "refresh-1", "expires_at": int(time.time()) + 10}
    w = World(monkeypatch, "hubspot", answer={"results": []}, held=held)
    invoke(w, "crm.contacts.list")
    assert json.loads(w.stored[0])["access_token"] == "access-2"
    assert w.vendor_calls[0][1]["headers"]["Authorization"] == "Bearer access-2"


def test_a_dead_sign_in_marks_the_connection_unhealthy(monkeypatch):
    held = {"access_token": "old", "refresh_token": None, "expires_at": 1}
    w = World(monkeypatch, "hubspot", answer={}, held=held)
    with pytest.raises(ProviderRefusedError):
        invoke(w, "crm.contacts.list")
    assert w.health and w.health[0]["ok"] is False and w.vendor_calls == []


def test_one_refused_operation_does_not_rewrite_the_connections_health(monkeypatch):
    w = World(monkeypatch, "hubspot", answer={"message": "missing scope"}, status=403)
    with pytest.raises(ProviderRefusedError, match="missing scope"):
        invoke(w, "crm.deals.list")
    assert w.health == []


def test_a_write_capability_is_refused_until_grants_exist(monkeypatch):
    from app.connectors.base import Capability

    provider_cls = type(oauth_provider_for("hubspot"))
    monkeypatch.setattr(provider_cls, "capabilities", (Capability("crm.contacts.create", "x", "contacts", "crm", writes=True),))
    w = World(monkeypatch, "hubspot", answer={})
    with pytest.raises(ValidationError, match="change data"):
        invoke(w, "crm.contacts.create")
    assert w.vendor_calls == []


def test_capabilities_lists_what_is_declared_for_any_caller(monkeypatch):
    w = World(monkeypatch, "slack", answer={})
    listed = operate(SETTINGS, caller(), operation="capabilities", arguments={"connector_keys": ["slack"]})
    assert listed["connectors"][0]["connector_key"] == "slack"
    assert {c["key"] for c in listed["connectors"][0]["capabilities"]} == {"slack.channels.list", "slack.messages.history"}
