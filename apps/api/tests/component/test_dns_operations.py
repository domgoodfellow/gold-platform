"""`app.services.dns.ensure_required_records`: who answers, and the four shapes `ensure` can take.

The vendor boundary (`app.services.dns.cloudflare`) is replaced here exactly as
`test_web_delivery_domains.py` replaces `app.providers.vercel.domains` -- this file proves the
capability's own sequencing: which connected zone answers for a hostname, that an identical record
is left alone, that a record this runtime already owns may be corrected, and that a record it does
not own is refused rather than overwritten.
"""

from __future__ import annotations

import json

import pytest

from app.core.config import IntegrationSettings
from app.services.dns import operations as ops

SETTINGS = IntegrationSettings(
    supabase_url="http://db.test",
    supabase_publishable_key="anon",
    supabase_jwt_secret="signing",
    state_secret="state-secret",
    redirect_uri="https://app.test/connect/oauth/callback",
)
ORG = "11111111-1111-4111-8111-111111111111"
CONNECTION = "22222222-2222-4222-8222-222222222222"
ZONE_RESOURCE = "33333333-3333-4333-8333-333333333333"
TOKEN = "caller-token"


class Response:
    def __init__(self, status: int, body) -> None:
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class World:
    """The caller's own PostgREST reads/writes, and the connection's stored credential."""

    def __init__(self, monkeypatch, *, zones=None, owned: dict[str, str] | None = None) -> None:
        self.zones = zones if zones is not None else [
            {"id": ZONE_RESOURCE, "connection_id": CONNECTION, "external_id": "zone-1", "display_name": "example.com"}
        ]
        self.owned = owned or {}  # cloudflare record id -> our resource id
        self.inserted: list[dict] = []
        self.patched: list[tuple[str, dict]] = []
        self.credential_secret: str | None = json.dumps({"access_token": "cf-access", "refresh_token": "cf-refresh", "expires_at": 9_999_999_999})

        monkeypatch.setattr(ops, "caller_rest", self._rest)
        monkeypatch.setattr(ops.db, "read_integration_credential", self._read_credential)

    def _rest(self, url, key, token, method, path, **kwargs):
        assert token == TOKEN
        if method == "GET" and path == "integration_connections":
            return Response(200, [{"id": CONNECTION}])
        if method == "GET" and path == "integration_resources":
            params = kwargs["params"]
            if params["resource_type"] == "eq.cloudflare_zone":
                return Response(200, self.zones)
            external_id = params["external_id"].removeprefix("eq.")
            owner = self.owned.get(external_id)
            return Response(200, [{"id": owner}] if owner else [])
        if method == "POST" and path == "integration_resources":
            self.inserted.append(kwargs["json"])
            return Response(201, kwargs["json"])
        if method == "PATCH" and path == "integration_resources":
            self.patched.append((kwargs["params"]["id"], kwargs["json"]))
            return Response(204, None)
        raise AssertionError(f"unexpected call {method} {path} {kwargs}")

    def _read_credential(self, settings, *, connection_id):
        assert connection_id == CONNECTION
        if self.credential_secret is None:
            return None
        return {"secret": self.credential_secret}


def test_a_business_with_no_cloudflare_connection_is_not_applied(monkeypatch):
    World(monkeypatch, zones=[])
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is False
    assert result.connection_id is None


def test_the_longest_matching_zone_wins(monkeypatch):
    world = World(
        monkeypatch,
        zones=[
            {"id": "r1", "connection_id": CONNECTION, "external_id": "zone-root", "display_name": "example.com"},
            {"id": "r2", "connection_id": CONNECTION, "external_id": "zone-shop", "display_name": "shop.example.com"},
        ],
    )
    monkeypatch.setattr(ops.cloudflare, "list_records", lambda token, zone_id, *, name, record_type: [{"id": "rec-1", "content": "cname.vercel-dns.com"}] if zone_id == "zone-shop" else (_ for _ in ()).throw(AssertionError("wrong zone")))
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="app.shop.example.com",
        records=[{"type": "CNAME", "name": "app.shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.zone_name == "shop.example.com"
    assert result.applied is True
    assert result.results[0].outcome == "unchanged"


def test_an_identical_existing_record_is_left_alone(monkeypatch):
    world = World(monkeypatch)
    monkeypatch.setattr(ops.cloudflare, "list_records", lambda token, zone_id, *, name, record_type: [{"id": "rec-1", "content": "cname.vercel-dns.com"}])
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is True
    assert result.results == [ops.RecordOutcome("CNAME", "shop.example.com", "cname.vercel-dns.com", "unchanged")]
    assert world.inserted == []


def test_an_absent_record_is_created_and_recorded_as_owned(monkeypatch):
    world = World(monkeypatch)
    monkeypatch.setattr(ops.cloudflare, "list_records", lambda token, zone_id, *, name, record_type: [])
    monkeypatch.setattr(ops.cloudflare, "create_record", lambda token, zone_id, *, record_type, name, value: {"id": "rec-new"})
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is True
    assert result.results[0].outcome == "created"
    assert world.inserted == [
        {
            "organization_id": ORG,
            "connection_id": CONNECTION,
            "resource_type": "cloudflare_dns_record",
            "external_id": "rec-new",
            "display_name": "CNAME shop.example.com",
            "metadata": {"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com", "zone": "example.com", "hostname": "shop.example.com"},
        }
    ]


def test_a_record_this_runtime_already_owns_is_corrected(monkeypatch):
    world = World(monkeypatch, owned={"rec-old": "our-resource-1"})
    monkeypatch.setattr(ops.cloudflare, "list_records", lambda token, zone_id, *, name, record_type: [{"id": "rec-old", "content": "stale-target.example.net"}])
    monkeypatch.setattr(ops.cloudflare, "update_record", lambda token, zone_id, record_id, *, record_type, name, value: {"id": record_id})
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is True
    assert result.results[0].outcome == "updated"
    assert world.patched == [("eq.our-resource-1", {"metadata": {"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com", "zone": "example.com", "hostname": "shop.example.com"}, "display_name": "CNAME shop.example.com"})]


def test_a_conflicting_record_this_runtime_does_not_own_is_refused_not_overwritten(monkeypatch):
    world = World(monkeypatch)  # no ownership recorded for "rec-someone-elses"
    monkeypatch.setattr(ops.cloudflare, "list_records", lambda token, zone_id, *, name, record_type: [{"id": "rec-someone-elses", "content": "a-customers-own-value.example.net"}])
    update_calls = []
    monkeypatch.setattr(ops.cloudflare, "update_record", lambda *a, **kw: update_calls.append((a, kw)))
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is False
    assert result.results[0].outcome == "conflict"
    assert update_calls == []  # never touched
    assert world.inserted == [] and world.patched == []


def test_with_no_credential_stored_nothing_is_applied(monkeypatch):
    world = World(monkeypatch)
    world.credential_secret = None
    result = ops.ensure_required_records(
        SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com",
        records=[{"type": "CNAME", "name": "shop.example.com", "value": "cname.vercel-dns.com"}],
    )
    assert result.applied is False


def test_no_settings_or_no_records_is_a_no_op_without_any_network_call():
    assert ops.ensure_required_records(None, token=TOKEN, organization_id=ORG, hostname="shop.example.com", records=[]).applied is False
    assert ops.ensure_required_records(SETTINGS, token=TOKEN, organization_id=ORG, hostname="shop.example.com", records=[]).applied is False
