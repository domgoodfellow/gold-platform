"""The Communications routing resolver: inbound route decisions and outbound identity, pure
logic over faked PostgREST responses.

What RLS actually enforces (tenant isolation on `communication_routes`/`communication_route_targets`,
who may write) is proven against real Postgres elsewhere; this file is the resolver's own
branching -- business hours, ring strategies, fallback, cycle rejection, callback affinity, and
outbound AUTO/MANUAL -- which is cheapest and most thoroughly proven as a pure function over a
faked transport, the same way `test_voice.py` proves TwiML shapes.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core import caller
from app.domains.communications import routing
from app.domains.communications.routing import (
    OutboundIdentityRefused,
    resolve_inbound_route,
    resolve_outbound_identity,
)

SETTINGS = type("Settings", (), {"supabase_url": "http://db.test", "supabase_publishable_key": "anon"})()
ORG = "org-1"
NUMBER = "number-1"


class FakeTransport:
    """Responds to a GET by matching the table name in the path, and to a POST (RPC) by
    matching the function name — a small router over what the resolver actually calls, not a
    generic REST fake."""

    def __init__(self, *, tables: dict[str, list[dict]] | None = None, rpcs: dict[str, object] | None = None):
        self.tables = tables or {}
        self.rpcs = rpcs or {}
        self.calls: list[tuple[str, str]] = []

    def get(self, url, headers=None, params=None, timeout=None):
        table = url.rsplit("/", 1)[-1]
        self.calls.append(("GET", table))
        return _Response(200, self.tables.get(table, []))

    def post(self, url, headers=None, json=None, timeout=None):
        function = url.rsplit("/", 1)[-1]
        self.calls.append(("POST", function))
        if function not in self.rpcs:
            return _Response(404, {"message": "unknown rpc"})
        return _Response(200, self.rpcs[function])


class _Response:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.text = str(body)
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._body


def _wire(monkeypatch, transport: FakeTransport) -> None:
    # Direct table reads go through this module's own `httpx.get`; RPC calls go through
    # `call_command` (`app.core.caller`), the same narrow-write door every other domain command
    # here uses — so both must be patched for the fake to see everything the resolver sends.
    monkeypatch.setattr(routing.httpx, "get", transport.get)
    monkeypatch.setattr(caller.httpx, "post", transport.post)


def _route(**overrides) -> dict:
    base = {
        "id": "route-1",
        "number_id": NUMBER,
        "enabled": True,
        "when_mode": "always",
        "ring_strategy": "everyone",
        "ring_timeout_seconds": 20,
        "destination_type": "members",
        "destination_external_number": None,
        "destination_route_id": None,
        "fallback_type": "voicemail",
        "fallback_external_number": None,
        "fallback_route_id": None,
        "callback_affinity_enabled": False,
    }
    base.update(overrides)
    return base


def _member(member_id: str, *, capable: bool = True) -> dict:
    return {"id": member_id, "role": {"capabilities": ["call.place"] if capable else []}}


NOW = datetime(2026, 1, 5, 15, 0, tzinfo=timezone.utc)  # a Monday, mid-afternoon


def test_no_route_names_the_number_and_the_org_has_no_catch_all(monkeypatch):
    _wire(monkeypatch, FakeTransport(tables={"communication_routes": []}))
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.reason == "no_route"
    assert decision.matched is False
    assert decision.target_type == "none"


def test_primary_destination_rings_every_eligible_member(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route()],
            "communication_route_targets": [{"member_id": "m1"}, {"member_id": "m2"}],
            "memberships": [_member("m1"), _member("m2")],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.reason == "primary_destination"
    assert decision.target_type == "members"
    assert decision.member_ids == ["m1", "m2"]
    assert decision.fallback_used is False


def test_a_disabled_route_matches_but_routes_nowhere(monkeypatch):
    _wire(monkeypatch, FakeTransport(tables={"communication_routes": [_route(enabled=False)]}))
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.matched is True
    assert decision.reason == "route_disabled"
    assert decision.target_type == "none"


def test_outside_business_hours_falls_back_to_voicemail(monkeypatch):
    transport = FakeTransport(
        tables={"communication_routes": [_route(when_mode="business_hours")]},
        rpcs={"organization_open_now": False},
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.within_hours is False
    assert decision.reason == "outside_business_hours"
    assert decision.target_type == "voicemail"
    assert decision.fallback_used is True


def test_inside_business_hours_reaches_the_primary_destination(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(when_mode="business_hours")],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1")],
        },
        rpcs={"organization_open_now": True},
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.within_hours is True
    assert decision.reason == "primary_destination"


def test_nobody_eligible_falls_back(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(fallback_type="external_number", fallback_external_number="+14165550100")],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1", capable=False)],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.reason == "no_eligible_destination"
    assert decision.target_type == "external_number"
    assert decision.external_number == "+14165550100"
    assert decision.fallback_used is True


def test_no_fallback_configured_ends_unhandled_rather_than_silently(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(fallback_type="none")],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1", capable=False)],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.target_type == "none"
    assert decision.warnings  # explains itself rather than staying silent


def test_sequential_preserves_explicit_order(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(ring_strategy="sequential")],
            "communication_route_targets": [{"member_id": "m3"}, {"member_id": "m1"}, {"member_id": "m2"}],
            "memberships": [_member("m1"), _member("m2"), _member("m3")],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.member_ids == ["m3", "m1", "m2"]


def test_round_robin_rotates_by_the_advanced_cursor(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(ring_strategy="round_robin")],
            "communication_route_targets": [{"member_id": "m1"}, {"member_id": "m2"}, {"member_id": "m3"}],
            "memberships": [_member("m1"), _member("m2"), _member("m3")],
        },
        rpcs={"advance_route_round_robin": 4},  # 4 % 3 == 1
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.member_ids == ["m2", "m3", "m1"]


def test_round_robin_is_one_update_statement_not_a_read_then_write(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(ring_strategy="round_robin")],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1")],
        },
        rpcs={"advance_route_round_robin": 0},
    )
    _wire(monkeypatch, transport)
    resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert ("POST", "advance_route_round_robin") in transport.calls


def test_callback_affinity_prefers_the_last_agent_over_the_ordinary_strategy(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(callback_affinity_enabled=True)],
            "communication_route_targets": [{"member_id": "m1"}, {"member_id": "m2"}],
            "memberships": [_member("m1"), _member("m2")],
            "calls": [{"created_by": "m2"}],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, from_number="+14165550199", at=NOW)
    assert decision.reason == "callback_affinity"
    assert decision.member_ids == ["m2"]


def test_callback_affinity_falls_through_when_the_preferred_agent_is_not_eligible(monkeypatch):
    transport = FakeTransport(
        tables={
            "communication_routes": [_route(callback_affinity_enabled=True)],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1")],
            "calls": [{"created_by": "m9"}],  # not among today's eligible targets
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, from_number="+14165550199", at=NOW)
    assert decision.reason == "primary_destination"
    assert decision.member_ids == ["m1"]


def test_a_route_that_falls_back_to_itself_is_rejected_rather_than_looping(monkeypatch):
    looping = _route(id="route-1", fallback_type="route", fallback_route_id="route-1")
    transport = FakeTransport(
        tables={
            "communication_routes": [looping],
            "communication_route_targets": [{"member_id": "m1"}],
            "memberships": [_member("m1", capable=False)],
        },
    )
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.reason == "route_loop"
    assert decision.fallback_used is True


def test_a_route_naming_another_route_as_destination_resolves_the_target(monkeypatch):
    # PostgREST would answer the *second* fetch (by id) with the target row; the fake keyed by
    # table name can only hold one list per table, so this proves the shape via a route that
    # points at itself and expects the recursion + cycle guard to fire, which is the property
    # that actually matters here — an infinite `destination_type: route` chain must terminate.
    pointer = _route(id="route-1", destination_type="route", destination_route_id="route-1")
    transport = FakeTransport(tables={"communication_routes": [pointer]})
    _wire(monkeypatch, transport)
    decision = resolve_inbound_route(SETTINGS, token="t", organization_id=ORG, number_id=NUMBER, at=NOW)
    assert decision.reason == "route_loop"


# ---------------------------------------------------------------------------
# Outbound identity
# ---------------------------------------------------------------------------

def _resolved(number_id: str, e164: str, source: str) -> list[dict]:
    """What `resolve_outbound_number` answers: one row, or none."""
    return [{"phone_number_id": number_id, "e164": e164, "source": source}]


class RecordingPost:
    """Stands where `httpx.post` would, answering the one resolver RPC and keeping what was sent."""

    def __init__(self, answer):
        self.answer = answer
        self.sent: list[tuple[str, dict]] = []

    def __call__(self, url, headers=None, json=None, timeout=None):
        self.sent.append((url.rsplit("/", 1)[-1], json))
        return _Response(200, self.answer)


@pytest.mark.parametrize(("source", "reason"), [
    ("preference", "auto_preference"),
    ("member_default", "auto_default_assignment"),
    ("member", "auto_first_eligible"),
    ("organization_default", "auto_organization_default"),
    ("shared", "auto_shared"),
])
def test_auto_reports_what_the_database_resolver_chose_and_why(monkeypatch, source, reason):
    post = RecordingPost(_resolved("n2", "+14165550102", source))
    monkeypatch.setattr(caller.httpx, "post", post)
    decision = resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="auto")
    assert (decision.phone_number_id, decision.e164, decision.reason) == ("n2", "+14165550102", reason)
    # One question, to the one resolver, naming no number: nothing is decided in this runtime.
    assert post.sent == [("resolve_outbound_number", {"p_organization_id": ORG})]


def test_auto_reads_no_table_of_its_own(monkeypatch):
    transport = FakeTransport(rpcs={"resolve_outbound_number": _resolved("n1", "+14165550101", "member_default")})
    _wire(monkeypatch, transport)
    resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="auto")
    assert transport.calls == [("POST", "resolve_outbound_number")]


def test_auto_with_nothing_at_all_refuses_rather_than_guessing(monkeypatch):
    transport = FakeTransport(rpcs={"resolve_outbound_number": []})
    _wire(monkeypatch, transport)
    with pytest.raises(OutboundIdentityRefused) as excinfo:
        resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="auto")
    assert excinfo.value.reason == "no_eligible_identity"


def test_manual_asks_the_resolver_about_the_named_number(monkeypatch):
    post = RecordingPost(_resolved("n1", "+14165550101", "member"))
    monkeypatch.setattr(caller.httpx, "post", post)
    decision = resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="manual", selected_phone_number_id="n1")
    assert decision.e164 == "+14165550101"
    assert decision.mode_applied == "manual"
    assert decision.reason == "manual_selected"
    assert post.sent == [("resolve_outbound_number", {"p_organization_id": ORG, "p_phone_number_id": "n1"})]


def test_manual_refuses_a_number_the_resolver_does_not_allow(monkeypatch):
    # The database answers nothing for a number that belongs to somebody else, to another business
    # or to nobody. They look identical here, which is the point: the browser's choice authorizes nothing.
    transport = FakeTransport(rpcs={"resolve_outbound_number": []})
    _wire(monkeypatch, transport)
    with pytest.raises(OutboundIdentityRefused) as excinfo:
        resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="manual", selected_phone_number_id="not-mine")
    assert excinfo.value.reason == "not_assigned"


def test_manual_with_no_selection_is_refused_before_any_guess(monkeypatch):
    transport = FakeTransport()
    _wire(monkeypatch, transport)
    with pytest.raises(OutboundIdentityRefused) as excinfo:
        resolve_outbound_identity(SETTINGS, token="t", organization_id=ORG, member_id="m1", mode="manual")
    assert excinfo.value.reason == "selection_required"
    assert transport.calls == []
