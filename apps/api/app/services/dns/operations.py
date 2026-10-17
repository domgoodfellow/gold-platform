"""Reconciling the DNS records a hosting provider asked for, through a tenant's connected DNS.

**The smallest coherent capability over a tenant's own OAuth connection, never a Cloudflare
control panel.** `app.services.web_delivery` asks `ensure_required_records` for a hostname and the
records a provider named; this resolves which connected zone answers for that hostname, reads what
is there, and writes only what is missing or only what GildOps itself already wrote once.

**Ownership, provable and not tenant-forgeable.** A DNS record this runtime creates or updates is
recorded as an `integration_resources` row under the connection that created it -- `resource_type
'cloudflare_dns_record'`, `external_id` the vendor's own record id. A record already at the vendor
with no such row is somebody else's, or nobody's doing GildOps can prove, and is refused rather
than silently replaced. Neither that row nor the `cloudflare_zone` rows this reads to resolve a
zone can be manufactured by a tenant session: `integration_resources_insert`/`_update` admit only a
row with no `connection_id` (an uploaded file, the uploaded-file rule); anything connection-scoped is written only
through `integration_operator`, via `record_managed_integration_resource` here and
`replace_integration_resources` for discovery -- the same role that reads the OAuth credential the
write itself used.

**Best-effort, on purpose.** The authoritative outcome is still the hosting provider's own recheck
(`app.providers.vercel.domains.check`, called again by the caller once this returns). A DNS write
that fails here leaves the manual, copy-the-records path exactly as able to finish the job as it
was before this existed (section 3 of the work order: Cloudflare is the first automation, not the
only registrar this platform will ever support).
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

from app.core import db
from app.core.config import IntegrationSettings
from app.core.postgrest import caller_rest
from app.connectors import oauth_app_for, oauth_provider_for
from app.providers.providers import UpstreamRefused
from app.services.dns import cloudflare

_CONNECTOR_KEY = "cloudflare"
_ZONE_RESOURCE_TYPE = "cloudflare_zone"
_RECORD_RESOURCE_TYPE = "cloudflare_dns_record"
_REFRESH_MARGIN_SECONDS = 120


@dataclass(frozen=True)
class RecordOutcome:
    type: str
    name: str
    value: str
    # created | updated | unchanged | conflict | failed
    outcome: str
    message: str | None = None


@dataclass(frozen=True)
class EnsureResult:
    applied: bool
    connection_id: str | None
    zone_name: str | None
    results: list[RecordOutcome] = field(default_factory=list)


def _get(settings: IntegrationSettings, token: str, path: str, params: dict) -> list[dict]:
    response = caller_rest(settings.supabase_url, settings.supabase_publishable_key, token, "GET", path, params=params)
    rows = response.json()
    return rows if isinstance(rows, list) else []


def _zone_for_hostname(settings: IntegrationSettings, token: str, organization_id: str, hostname: str) -> dict | None:
    """The connected Cloudflare zone this hostname falls under, or `None`. Longest match wins when
    more than one connected zone could claim it -- `shop.example.com` over `example.com` for a
    business that has connected both."""
    connections = _get(
        settings,
        token,
        "integration_connections",
        {
            "organization_id": f"eq.{organization_id}",
            "connector_key": f"eq.{_CONNECTOR_KEY}",
            "status": "eq.active",
            "select": "id",
        },
    )
    connection_ids = [row["id"] for row in connections if row.get("id")]
    if not connection_ids:
        return None

    zones = _get(
        settings,
        token,
        "integration_resources",
        {
            "organization_id": f"eq.{organization_id}",
            "connection_id": f"in.({','.join(connection_ids)})",
            "resource_type": f"eq.{_ZONE_RESOURCE_TYPE}",
            "select": "id,connection_id,external_id,display_name",
        },
    )

    host = hostname.strip().lower().rstrip(".")
    best: dict | None = None
    for zone in zones:
        name = str(zone.get("display_name") or "").strip().lower()
        if not name:
            continue
        if host != name and not host.endswith("." + name):
            continue
        if best is None or len(name) > len(str(best.get("display_name") or "")):
            best = zone
    return best


def _held_access_token(settings: IntegrationSettings, connection_id: str) -> str | None:
    import json

    row = db.read_integration_credential(settings, connection_id=connection_id)
    if not row or not row.get("secret"):
        return None
    try:
        held = json.loads(row["secret"])
    except json.JSONDecodeError:
        return None

    access_token = held.get("access_token")
    expires_at = int(held.get("expires_at") or 0)
    if expires_at - _REFRESH_MARGIN_SECONDS > int(time.time()):
        return access_token

    refresh_token = held.get("refresh_token")
    if not refresh_token:
        return access_token  # Let the vendor itself say no; nothing here can renew it.

    provider = oauth_provider_for(_CONNECTOR_KEY)
    app = oauth_app_for(_CONNECTOR_KEY)
    if provider is None or app is None:
        return access_token

    try:
        renewed = provider.refresh(app, refresh_token=refresh_token)
    except UpstreamRefused:
        return access_token

    db.store_integration_credential(
        settings,
        connection_id=connection_id,
        secret=json.dumps(
            {
                "access_token": renewed.access_token,
                "refresh_token": renewed.refresh_token,
                "expires_at": renewed.expires_at,
            }
        ),
    )
    return renewed.access_token


def _owned_record_id(
    settings: IntegrationSettings, token: str, organization_id: str, connection_id: str, external_id: str
) -> str | None:
    rows = _get(
        settings,
        token,
        "integration_resources",
        {
            "organization_id": f"eq.{organization_id}",
            "connection_id": f"eq.{connection_id}",
            "resource_type": f"eq.{_RECORD_RESOURCE_TYPE}",
            "external_id": f"eq.{external_id}",
            "select": "id",
        },
    )
    return rows[0]["id"] if rows else None


def _record_provenance(
    settings: IntegrationSettings,
    *,
    connection_id: str,
    zone_name: str,
    hostname: str,
    record: dict,
    external_id: str,
) -> None:
    """Through `integration_operator`, never the caller's own forwarded token (work order 1
    closeout, section 2): a tenant session cannot insert or edit a connection-scoped resource at
    all, so this is the only door, and it is the same role that read the access token the write
    itself used. Best-effort: the hosting provider's own recheck is still the fact of record
    (module header). Losing this row only makes a future run treat the vendor's existing answer as
    unowned, which is the safe direction to fail in -- refused rather than overwritten, never the
    other way.
    """
    try:
        db.record_managed_integration_resource(
            settings,
            connection_id=connection_id,
            resource_type=_RECORD_RESOURCE_TYPE,
            external_id=external_id,
            display_name=f"{record['type']} {record['name']}",
            metadata={"type": record["type"], "name": record["name"], "value": record["value"], "zone": zone_name, "hostname": hostname},
        )
    except RuntimeError:
        pass


def _ensure_one(
    settings: IntegrationSettings,
    token: str,
    *,
    organization_id: str,
    connection_id: str,
    zone_id: str,
    zone_name: str,
    hostname: str,
    access_token: str,
    record: dict,
) -> RecordOutcome:
    record_type = str(record["type"]).upper()
    name = str(record["name"]).strip().lower().rstrip(".")
    value = str(record["value"]).strip()
    # MX alone carries one, and two MX records with the same target and different preferences are
    # two different records -- so it is part of what "already correct" means, not decoration.
    priority = record.get("priority") if isinstance(record.get("priority"), int) else None

    try:
        existing = cloudflare.list_records(access_token, zone_id, name=name, record_type=record_type)
    except UpstreamRefused as failure:
        return RecordOutcome(record_type, name, value, "failed", str(failure))

    def correct(answer: dict) -> bool:
        return answer.get("content") == value and (priority is None or answer.get("priority") == priority)

    match = next((r for r in existing if correct(r)), None)
    if match is not None:
        return RecordOutcome(record_type, name, value, "unchanged")

    if existing:
        current = existing[0]
        owned_id = _owned_record_id(settings, token, organization_id, connection_id, str(current.get("id") or ""))
        if owned_id is None:
            return RecordOutcome(record_type, name, value, "conflict", "A different record already answers for this name.")
        try:
            updated = cloudflare.update_record(
                access_token, zone_id, str(current["id"]), record_type=record_type, name=name, value=value, priority=priority
            )
        except UpstreamRefused as failure:
            return RecordOutcome(record_type, name, value, "failed", str(failure))
        _record_provenance(
            settings, connection_id=connection_id, zone_name=zone_name, hostname=hostname,
            record={"type": record_type, "name": name, "value": value}, external_id=str(updated["id"]),
        )
        return RecordOutcome(record_type, name, value, "updated")

    try:
        created = cloudflare.create_record(
            access_token, zone_id, record_type=record_type, name=name, value=value, priority=priority
        )
    except UpstreamRefused as failure:
        return RecordOutcome(record_type, name, value, "failed", str(failure))
    _record_provenance(
        settings, connection_id=connection_id, zone_name=zone_name, hostname=hostname,
        record={"type": record_type, "name": name, "value": value}, external_id=str(created["id"]),
    )
    return RecordOutcome(record_type, name, value, "created")


@dataclass(frozen=True)
class AutomationPreview:
    """Whether a connected Cloudflare zone could answer for this hostname -- read-only, no write
    at all, so a caller can offer a review step before the first consequential DNS mutation
    (work order 1 closeout, section 3) rather than writing immediately."""

    available: bool
    connection_id: str | None
    zone_name: str | None


def preview_automation(
    settings: IntegrationSettings | None, *, token: str, organization_id: str, hostname: str
) -> AutomationPreview:
    if settings is None:
        return AutomationPreview(available=False, connection_id=None, zone_name=None)

    zone = _zone_for_hostname(settings, token, organization_id, hostname)
    if zone is None:
        return AutomationPreview(available=False, connection_id=None, zone_name=None)

    # A matching zone with no usable credential is not "available" -- nothing for Review to offer
    # that Apply could actually do.
    if not _held_access_token(settings, zone["connection_id"]):
        return AutomationPreview(available=False, connection_id=zone["connection_id"], zone_name=zone["display_name"])

    return AutomationPreview(available=True, connection_id=zone["connection_id"], zone_name=zone["display_name"])


def ensure_required_records(
    settings: IntegrationSettings | None,
    *,
    token: str,
    organization_id: str,
    hostname: str,
    records: list[dict],
) -> EnsureResult:
    """Ensure every record a hosting provider asked for, through this business's own connected
    Cloudflare zone if it has one. `applied` is true only when every record needed no manual
    action; a `conflict` or `failed` entry in `results` is what the manual path still has to say."""
    if settings is None or not records:
        return EnsureResult(applied=False, connection_id=None, zone_name=None)

    zone = _zone_for_hostname(settings, token, organization_id, hostname)
    if zone is None:
        return EnsureResult(applied=False, connection_id=None, zone_name=None)

    access_token = _held_access_token(settings, zone["connection_id"])
    if not access_token:
        return EnsureResult(applied=False, connection_id=zone["connection_id"], zone_name=zone["display_name"])

    results = [
        _ensure_one(
            settings,
            token,
            organization_id=organization_id,
            connection_id=zone["connection_id"],
            zone_id=zone["external_id"],
            zone_name=zone["display_name"],
            hostname=hostname,
            access_token=access_token,
            record=record,
        )
        for record in records
    ]
    applied = bool(results) and all(r.outcome in ("created", "updated", "unchanged") for r in results)
    return EnsureResult(applied=applied, connection_id=zone["connection_id"], zone_name=zone["display_name"], results=results)


def ensure_result_view(result: EnsureResult) -> dict:
    return {
        "applied": result.applied,
        "connectionId": result.connection_id,
        "zoneName": result.zone_name,
        "records": [asdict(r) for r in result.results],
    }
