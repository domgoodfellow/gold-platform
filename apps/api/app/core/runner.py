"""Reaching Postgres as the thing that turns the clock.

**TEMPORARY LEGACY COMPATIBILITY**, exactly as `app.core.db` is — see that module's docstring.
`machine_token` here signs with the same `SUPABASE_JWT_SECRET`; no human request ever reaches
this file or reads that secret (`app/auth` handles people, with no signing key of its own).

**The second writer with no human caller**, and it is deliberately built the same way as the
first: its own Postgres role, its own three `execute` grants, and emphatically not
service-role. `automation_runner` holds no grant on any table at all, so nothing here can read a
customer or a job even by accident — what it gets back from `claim_message_deliveries` is an
address, the finished words and, for an email, the business's own resolved sender, and what it can
say back is what the provider answered.

Identity still arrives as a JWT. The `sub` is the automation actor from
`20260831000002_automations.sql` — a real `auth.users` row with no password and no address — so
`events.actor_id` stays satisfiable without a second machine-only actor shape.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import RunnerSettings
from app.core.db import machine_token

ROLE = "automation_runner"

# The automation's own auth.users row. It has no email and no password: the only way to act as
# it is to hold the JWT secret.
AUTOMATION_ACTOR = "00000000-0000-4000-8000-0000000000a2"


@dataclass(frozen=True)
class Place:
    """Somewhere a rule is watching, what it is watching for, and which hour it cares about.

    **The hour is what keeps this from being unusable.** A provider answers with a week of
    hourly numbers; a rule reads the one for the hour a job starts in and never looks at
    another. Asking narrowly is the difference between a few rows a tick and fifty thousand a
    day.
    """

    location_id: str
    latitude: float
    longitude: float
    metric: str
    needed_at: str


@dataclass(frozen=True)
class QueuedMessage:
    """One claimed delivery. For an email, the sender was resolved by the database from this
    business's own verified addresses (`app.organization_email_sender`), together with the provider
    account that holds its sending domain; this runtime never chooses a From address."""

    id: str
    channel: str
    recipient: str
    subject_line: str
    body: str
    from_address: str | None = None
    from_name: str | None = None
    reply_to: str | None = None
    provider_key: str | None = None
    provider_account_id: str | None = None


def _post(settings: RunnerSettings, function: str, payload: dict) -> httpx.Response:
    token = machine_token(settings.supabase_jwt_secret, role=ROLE, sub=AUTOMATION_ACTOR)

    return httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/{function}",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30.0,
    )


def run_due_automations(settings: RunnerSettings) -> int:
    """Ask what is due and do it. Returns how many rules acted.

    The whole scheduler is a query on the other side of this call: there is no queue to
    drain and nothing held between invocations. A tick that runs twice is a tick that ran once,
    because every action this platform has is one a repeat leaves alone.
    """
    response = _post(settings, "run_due_automations", {})
    if response.status_code >= 400:
        raise RuntimeError(f"run_due_automations failed: {response.status_code}")
    return int(response.json() or 0)


def claim_deliveries(settings: RunnerSettings, limit: int = 50) -> list[QueuedMessage]:
    """Take queued deliveries, each exactly once. A claimed delivery must be finished with
    `finish_delivery`; one that never is goes back to the queue (an email) or is failed as
    uncertain (a text message) by the database after ten minutes."""
    response = _post(settings, "claim_message_deliveries", {"p_limit": limit})
    if response.status_code >= 400:
        raise RuntimeError(f"claim_message_deliveries failed: {response.status_code}")

    return [
        QueuedMessage(
            id=row["id"],
            channel=row["channel"],
            recipient=row["recipient"],
            subject_line=row["subject_line"],
            body=row["body"],
            from_address=row.get("from_address"),
            from_name=row.get("from_name"),
            reply_to=row.get("reply_to"),
            provider_key=row.get("provider_key"),
            provider_account_id=row.get("provider_account_id"),
        )
        for row in response.json() or []
    ]


def finish_delivery(
    settings: RunnerSettings,
    *,
    message_id: str,
    outcome: str,
    external_id: str | None = None,
    detail: str | None = None,
) -> None:
    """Say what happened to one claimed delivery: `accepted` (the provider took it, which is not
    the same as it arriving), `rejected`, `failed`, or `retry` (back to the queue).

    Takes no organization id, exactly as `record_provider_payment` does not: the row already
    knows which business it belongs to, so the caller supplies what happened and never where it
    lands.
    """
    response = _post(
        settings,
        "finish_message_delivery",
        {"p_id": message_id, "p_outcome": outcome, "p_external_id": external_id, "p_detail": detail},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"finish_message_delivery failed: {response.status_code}")


def places_to_watch(settings: RunnerSettings) -> list[Place]:
    """Where to ask, and what to ask about.

    **The rules decide this, not a setting.** A business that has written no reading-triggered
    rule never appears here, so this platform never asks anybody about one of its places — which
    is the difference between an integration a business switched on and a service that quietly
    watches everybody.
    """
    response = _post(settings, "places_to_watch", {})
    if response.status_code >= 400:
        raise RuntimeError(f"places_to_watch failed: {response.status_code}")

    return [
        Place(
            location_id=row["location_id"],
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
            metric=row["metric"],
            needed_at=row["needed_at"],
        )
        for row in response.json() or []
    ]


def record_external_readings(
    settings: RunnerSettings, *, location_id: str, readings: list[dict]
) -> int:
    """Write down what somebody outside said about one place.

    **One call per place, not one per number**, which is the whole reason this is plural. The
    first version wrote each reading on its own round trip; a provider answers with a week of
    hourly figures, so five places became eight hundred and forty calls and the tick never
    returned. That was found by running it rather than by reading it.

    Names a location rather than an organization, exactly as the other writes on this axis do
    not take one: the row already knows which business owns it.
    """
    if not readings:
        return 0

    response = _post(
        settings,
        "record_external_readings",
        {"p_location_id": location_id, "p_readings": readings},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_external_readings failed: {response.status_code}")
    return int(response.json() or 0)
