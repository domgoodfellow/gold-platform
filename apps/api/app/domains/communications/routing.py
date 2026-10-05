"""Deciding where a call goes -- the one Communications routing resolver.

**Why this lives here and not in `apps/web`'s TS domain layer.** The two runtimes cannot call
each other (D30): a live inbound call needs this answer synchronously, from the process that is
about to answer Twilio, so the resolver has to run in Python. The work order's own requirement --
"preview MUST call the same routing resolver used by runtime execution, never a second UI
approximation" -- is only satisfiable this way: one function, called both by the carrier's own
webhook (a future slice; not wired in this one) and by the preview endpoint `apps/web` reaches
over HTTP, exactly as it already reaches `wrap_up_call`.

**Everything here reads Postgres under the caller's own forwarded token** (D17), the same as
`wrap_up_call` and `app.domains.web_delivery.domains`. Nothing is decided by a role this runtime
mints; RLS on `communication_routes`/`communication_route_targets`/`calls`/`memberships` is what
actually governs whether a row is visible, and a cross-organization id would simply see nothing.

**A route is not a workflow engine.** The recursion here exists for exactly one shape -- a route
naming another route as its destination or its fallback -- and `visited_route_ids` is the cycle
guard the migration's own comment promises: a constraint can refuse a direct self-loop, but only
this resolver can see a longer cycle a later edit created.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone as dt_timezone
from typing import Any

import httpx

from app.core.caller import CommandFailed, SupabaseCallerSettings, call_command

TargetType = str  # 'members' | 'external_number' | 'voicemail' | 'none'


class RoutingLookupFailed(RuntimeError):
    """A read this resolver needed came back refused or malformed -- never guessed past."""


@dataclass(frozen=True)
class RouteDecision:
    route_id: str | None
    matched: bool
    within_hours: bool
    target_type: TargetType
    member_ids: list[str]
    external_number: str | None
    ring_strategy: str | None
    ring_timeout_seconds: int | None
    reason: str
    fallback_used: bool
    warnings: list[str] = field(default_factory=list)


def _get(settings: SupabaseCallerSettings, token: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = httpx.get(
        f"{settings.supabase_url}/rest/v1/{path}",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
        params=params,
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise RoutingLookupFailed(f"{path} lookup refused ({response.status_code})")
    return response.json()


def _rpc(settings: SupabaseCallerSettings, token: str, function: str, arguments: dict[str, Any]) -> Any:
    """`call_command` (`app.core.caller`), the same narrow-write door every other domain command
    here reaches Postgres through -- bare argument names, auto-prefixed with `p_`, so this file's
    RPC arguments are found by `tests/contract/test_rpc_contract.py` the same way every other
    caller's are, rather than by a second, differently-shaped RPC helper."""
    try:
        return call_command(settings, token=token, function=function, arguments=arguments)
    except CommandFailed as failure:
        raise RoutingLookupFailed(f"{function} refused: {failure}") from failure


def _fetch_route_by_number(settings, token, organization_id: str, number_id: str | None) -> dict | None:
    if number_id:
        own = _get(settings, token, "communication_routes", {
            "organization_id": f"eq.{organization_id}", "number_id": f"eq.{number_id}", "select": "*",
        })
        if own:
            return own[0]
    default = _get(settings, token, "communication_routes", {
        "organization_id": f"eq.{organization_id}", "number_id": "is.null", "select": "*",
    })
    return default[0] if default else None


def _fetch_route_by_id(settings, token, organization_id: str, route_id: str) -> dict | None:
    rows = _get(settings, token, "communication_routes", {
        "organization_id": f"eq.{organization_id}", "id": f"eq.{route_id}", "select": "*",
    })
    return rows[0] if rows else None


def _fetch_target_member_ids(settings, token, organization_id: str, route_id: str, slot: str) -> list[str]:
    rows = _get(settings, token, "communication_route_targets", {
        "organization_id": f"eq.{organization_id}", "route_id": f"eq.{route_id}", "slot": f"eq.{slot}",
        "order": "position.asc", "select": "member_id",
    })
    return [row["member_id"] for row in rows]


def _eligible_member_ids(settings, token, organization_id: str, member_ids: list[str]) -> list[str]:
    """Active membership and `call.place` -- the one canonical capability fact (I12), never
    re-derived. Order preserved: sequential and round-robin both depend on it."""
    if not member_ids:
        return []
    id_list = ",".join(member_ids)
    rows = _get(settings, token, "memberships", {
        "organization_id": f"eq.{organization_id}", "id": f"in.({id_list})",
        "select": "id,role:roles!memberships_role_same_org(capabilities)",
    })
    eligible = {
        row["id"] for row in rows
        if "call.place" in ((row.get("role") or {}).get("capabilities") or [])
    }
    return [member_id for member_id in member_ids if member_id in eligible]


def _callback_affinity_member(settings, token, organization_id: str, from_number: str | None, eligible: list[str]) -> str | None:
    """"Return calls to the last agent" (tenant-facing wording) -- the one recent outbound call
    to this caller, if its agent is still eligible. Read-only over `calls`; nothing new to store."""
    if not from_number or not eligible:
        return None
    rows = _get(settings, token, "calls", {
        "organization_id": f"eq.{organization_id}", "to_number": f"eq.{from_number}", "direction": "eq.outbound",
        "order": "started_at.desc", "limit": "1", "select": "created_by",
    })
    if not rows:
        return None
    candidate = rows[0].get("created_by")
    return candidate if candidate in eligible else None


def _ordered_by_strategy(settings, token, organization_id: str, route_id: str, strategy: str, eligible: list[str]) -> list[str]:
    if not eligible:
        return []
    if strategy == "round_robin":
        cursor = _rpc(settings, token, "advance_route_round_robin", {"organization_id": organization_id, "route_id": route_id})
        index = int(cursor or 0) % len(eligible)
        return eligible[index:] + eligible[:index]
    # 'everyone' rings all of them at once; 'sequential' rings this exact order, one at a time --
    # both are "this list, in this order", and the difference is the caller's ring behaviour, not
    # a fact this resolver decides.
    return eligible


def _members_decision(route: dict, member_ids: list[str], *, within_hours: bool, reason: str, fallback_used: bool, warnings: list[str] | None = None) -> RouteDecision:
    return RouteDecision(
        route_id=route["id"], matched=True, within_hours=within_hours, target_type="members",
        member_ids=member_ids, external_number=None, ring_strategy=route["ring_strategy"],
        ring_timeout_seconds=route["ring_timeout_seconds"], reason=reason, fallback_used=fallback_used,
        warnings=warnings or [],
    )


def _resolve_route(
    settings, token: str, organization_id: str, route: dict, *, from_number: str | None,
    at: datetime, visited: frozenset[str],
) -> RouteDecision:
    route_id = route["id"]
    if route_id in visited:
        return RouteDecision(route_id, True, True, "none", [], None, None, None, "route_loop", True,
                              ["A route referred back to one already tried in this call; stopped rather than looping."])
    visited = visited | {route_id}

    if not route["enabled"]:
        return RouteDecision(route_id, True, True, "none", [], None, None, None, "route_disabled", False)

    within_hours = True
    if route["when_mode"] == "business_hours":
        within_hours = bool(_rpc(settings, token, "organization_open_now", {"organization_id": organization_id, "at": at.isoformat()}))
    if not within_hours:
        return _resolve_fallback(settings, token, organization_id, route, from_number=from_number, at=at, visited=visited, reason="outside_business_hours")

    if route["destination_type"] == "external_number":
        return RouteDecision(route_id, True, True, "external_number", [], route["destination_external_number"], None,
                              route["ring_timeout_seconds"], "destination_external_number", False)

    if route["destination_type"] == "route":
        target = _fetch_route_by_id(settings, token, organization_id, route["destination_route_id"])
        if not target:
            return _resolve_fallback(settings, token, organization_id, route, from_number=from_number, at=at, visited=visited, reason="destination_route_missing")
        return _resolve_route(settings, token, organization_id, target, from_number=from_number, at=at, visited=visited)

    primary_member_ids = _fetch_target_member_ids(settings, token, organization_id, route_id, "primary")
    eligible = _eligible_member_ids(settings, token, organization_id, primary_member_ids)

    if route["callback_affinity_enabled"]:
        affinity_member = _callback_affinity_member(settings, token, organization_id, from_number, eligible)
        if affinity_member:
            return _members_decision(route, [affinity_member], within_hours=True, reason="callback_affinity", fallback_used=False)

    if not eligible:
        return _resolve_fallback(settings, token, organization_id, route, from_number=from_number, at=at, visited=visited, reason="no_eligible_destination")

    ordered = _ordered_by_strategy(settings, token, organization_id, route_id, route["ring_strategy"], eligible)
    return _members_decision(route, ordered, within_hours=True, reason="primary_destination", fallback_used=False)


def _resolve_fallback(
    settings, token: str, organization_id: str, route: dict, *, from_number: str | None,
    at: datetime, visited: frozenset[str], reason: str,
) -> RouteDecision:
    route_id = route["id"]
    within_hours = reason != "outside_business_hours"
    fallback_type = route["fallback_type"]

    if fallback_type == "none":
        return RouteDecision(route_id, True, within_hours, "none", [], None, None, None, reason, True,
                              ["No fallback is configured for this route; the call ends unhandled."])

    if fallback_type == "voicemail":
        return RouteDecision(route_id, True, within_hours, "voicemail", [], None, None, None, reason, True)

    if fallback_type == "external_number":
        return RouteDecision(route_id, True, within_hours, "external_number", [], route["fallback_external_number"], None,
                              route["ring_timeout_seconds"], reason, True)

    if fallback_type == "route" and route["fallback_route_id"]:
        target = _fetch_route_by_id(settings, token, organization_id, route["fallback_route_id"])
        if target:
            nested = _resolve_route(settings, token, organization_id, target, from_number=from_number, at=at, visited=visited)
            # The nested resolution's own reason wins when it is more specific than why we fell
            # back here in the first place — a loop caught one level down must say so, not be
            # reported as this route's ordinary "nobody eligible".
            nested_reason = nested.reason if nested.reason in ("route_loop", "route_disabled") else reason
            return RouteDecision(nested.route_id, True, nested.within_hours, nested.target_type, nested.member_ids,
                                  nested.external_number, nested.ring_strategy, nested.ring_timeout_seconds, nested_reason, True, nested.warnings)

    if fallback_type == "members":
        fallback_member_ids = _fetch_target_member_ids(settings, token, organization_id, route_id, "fallback")
        eligible = _eligible_member_ids(settings, token, organization_id, fallback_member_ids)
        if eligible:
            ordered = _ordered_by_strategy(settings, token, organization_id, route_id, "everyone", eligible)
            return _members_decision(route, ordered, within_hours=within_hours, reason=reason, fallback_used=True)

    return RouteDecision(route_id, True, within_hours, "voicemail", [], None, None, None, f"{reason}_fallback_unreachable", True,
                          ["The fallback destination has nobody eligible either; ending at voicemail."])


@dataclass(frozen=True)
class OutboundIdentityDecision:
    mode_requested: str  # 'auto' | 'manual'
    mode_applied: str
    phone_number_id: str | None
    e164: str | None
    reason: str
    warnings: list[str] = field(default_factory=list)


class OutboundIdentityRefused(RuntimeError):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


def _member_eligible_assignments(settings, token, organization_id: str, member_id: str) -> list[dict]:
    """This member's own active, ready, outbound-capable numbers -- never another member's,
    and never a number this business has taken out of service. Ready is the database's reading of
    the provider's state (`phone_number_readiness`), not a flag a business or this resolver keeps."""
    rows = _get(settings, token, "phone_number_assignments", {
        "organization_id": f"eq.{organization_id}", "member_id": f"eq.{member_id}", "released_at": "is.null",
        "select": "id,phone_number_id,is_default,number:phone_numbers!phone_number_assignments_organization_id_phone_number_id_fkey(id,e164,lifecycle,voice_outbound_enabled)",
    })
    if not rows:
        return []
    ready = {
        row["phone_number_id"]
        for row in _get(settings, token, "phone_number_readiness", {
            "organization_id": f"eq.{organization_id}",
            "phone_number_id": f"in.({','.join(row['phone_number_id'] for row in rows)})",
            "readiness": "eq.ready",
            "select": "phone_number_id",
        })
    }
    eligible = []
    for row in rows:
        number = row.get("number") or {}
        if number.get("lifecycle") == "active" and number.get("voice_outbound_enabled") and row["phone_number_id"] in ready:
            eligible.append(row)
    return eligible


def resolve_outbound_identity(
    settings: SupabaseCallerSettings, *, token: str, organization_id: str, member_id: str,
    mode: str, selected_phone_number_id: str | None = None,
) -> OutboundIdentityDecision:
    """AUTO picks the member's own default assignment, else the organization's calling number.
    MANUAL trusts nothing the caller merely names: the selection must be one of this member's own
    active assignments, resolved server-side (the work order's own rule -- the browser selects
    nothing on its own authority)."""
    assignments = _member_eligible_assignments(settings, token, organization_id, member_id)

    if mode == "manual":
        if not selected_phone_number_id:
            raise OutboundIdentityRefused("selection_required", "Choose one of your own numbers.")
        match = next((row for row in assignments if row["phone_number_id"] == selected_phone_number_id), None)
        if not match:
            raise OutboundIdentityRefused("not_assigned", "That number is not assigned to you, or is not currently usable.")
        number = match["number"]
        return OutboundIdentityDecision("manual", "manual", number["id"], number["e164"], "manual_selected")

    default_assignment = next((row for row in assignments if row["is_default"]), None)
    if default_assignment:
        number = default_assignment["number"]
        return OutboundIdentityDecision("auto", "auto", number["id"], number["e164"], "auto_default_assignment")

    if assignments:
        number = assignments[0]["number"]
        return OutboundIdentityDecision("auto", "auto", number["id"], number["e164"], "auto_first_eligible",
                                          ["No default number is set; using the first eligible one assigned to you."])

    org_default = _get(settings, token, "telephony_settings", {"organization_id": f"eq.{organization_id}", "select": "calling_number"})
    calling_number = org_default[0]["calling_number"] if org_default else None
    if calling_number:
        return OutboundIdentityDecision("auto", "auto", None, calling_number, "auto_organization_default")

    raise OutboundIdentityRefused("no_eligible_identity", "No outbound number is available for this business yet.")


def resolve_inbound_route(
    settings: SupabaseCallerSettings, *, token: str, organization_id: str,
    number_id: str | None, from_number: str | None = None, at: datetime | None = None,
) -> RouteDecision:
    """The entry point: which number rang, and who was calling. Everything else is `_resolve_route`."""
    at = at or datetime.now(dt_timezone.utc)
    route = _fetch_route_by_number(settings, token, organization_id, number_id)
    if not route:
        return RouteDecision(None, False, True, "none", [], None, None, None, "no_route", False,
                              ["No route names this number and this organization has no catch-all."])
    return _resolve_route(settings, token, organization_id, route, from_number=from_number, at=at, visited=frozenset())
