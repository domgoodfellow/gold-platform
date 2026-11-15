"""Deciding where a call goes -- the one Communications routing resolver.

**Why this lives here and not in `apps/web`'s TS domain layer.** The two runtimes cannot call
each other: a live inbound call needs this answer synchronously, from the process that is
about to answer Twilio, so the resolver has to run in Python. The work order's own requirement --
"preview MUST call the same routing resolver used by runtime execution, never a second UI
approximation" -- is only satisfiable this way: one function, called both by the carrier's own
webhook and by the preview endpoint `apps/web` reaches
over HTTP, exactly as it already reaches `wrap_up_call`.

**Everything here reads Postgres under the caller's own forwarded token**, the same as
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
    if hasattr(settings, 'routing_read'):
        return settings.routing_read(path, params)
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
    if hasattr(settings, 'routing_command'):
        return settings.routing_command(token, function, arguments)
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
    """Active membership and `call.place` -- the one canonical capability fact, never
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

    if route['destination_type'] == 'ai_receptionist':
        return RouteDecision(route_id, True, True, 'ai_receptionist', [], None, None, route['ring_timeout_seconds'], 'ai_receptionist', False)

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


_OUTBOUND_REASON = {
    "preference": "auto_preference",
    "member_default": "auto_default_assignment",
    "member": "auto_first_eligible",
    "organization_default": "auto_organization_default",
    "shared": "auto_shared",
}


def resolve_outbound_identity(
    settings: SupabaseCallerSettings, *, token: str, organization_id: str, member_id: str,
    mode: str, selected_phone_number_id: str | None = None,
) -> OutboundIdentityDecision:
    """Asks the database's one resolver, `resolve_outbound_number`, under the caller's own token.

    That function is what a placed call uses, so this answer and a real call cannot differ: the
    same candidates (the member's preference, their default, their other assigned numbers, the
    business's default, a shared number), the same readiness, the same order. Nothing is decided
    here. `member_id` is accepted for the endpoint's existing contract; the member is whoever the
    token belongs to, and naming another member changes nothing.

    AUTO names no number. MANUAL names one, and the resolver answers only if this member may dial
    from it (the browser selects nothing on its own authority)."""
    if mode == "manual" and not selected_phone_number_id:
        raise OutboundIdentityRefused("selection_required", "Choose one of your own numbers.")

    arguments: dict[str, Any] = {"organization_id": organization_id}
    if mode == "manual":
        arguments["phone_number_id"] = selected_phone_number_id
    rows = _rpc(settings, token, "resolve_outbound_number", arguments)
    row = rows[0] if isinstance(rows, list) and rows else None

    if not row:
        if mode == "manual":
            raise OutboundIdentityRefused("not_assigned", "That number is not one you may call from, or is not currently usable.")
        raise OutboundIdentityRefused("no_eligible_identity", "No outbound number is available to you in this business yet.")

    if mode == "manual":
        return OutboundIdentityDecision("manual", "manual", row["phone_number_id"], row["e164"], "manual_selected")
    return OutboundIdentityDecision("auto", "auto", row["phone_number_id"], row["e164"],
                                      _OUTBOUND_REASON.get(row.get("source"), "auto"))


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


def resolve_inbound_fallback(settings, *, token, organization_id, number_id, from_number=None, at=None, route_id=None):
    at = at or datetime.now(dt_timezone.utc)
    route = _fetch_route_by_id(settings, token, organization_id, route_id) if route_id else _fetch_route_by_number(settings, token, organization_id, number_id)
    if not route:
        return resolve_inbound_route(settings, token=token, organization_id=organization_id, number_id=number_id, from_number=from_number, at=at)
    return _resolve_fallback(settings, token, organization_id, route, from_number=from_number, at=at, visited=frozenset({route['id']}), reason='no_answer')
