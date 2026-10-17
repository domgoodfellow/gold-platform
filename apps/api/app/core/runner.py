"""Reaching Postgres as the thing that turns the clock.

**TEMPORARY LEGACY COMPATIBILITY**, exactly as `app.core.db` is — see that module's docstring.
`machine_token` here signs with the same `SUPABASE_JWT_SECRET`; no human request ever reaches
this file or reads that secret (`app/auth` handles people, with no signing key of its own).

**The second writer with no human caller**, and it is deliberately built the same way as the
first: its own Postgres role, its own three `execute` grants, and emphatically not
service-role. `automation_runner` holds no grant on any table at all, so nothing here can read a
customer or a job even by accident — what it gets back from `queued_messages` is an address and
the finished words, and what it can say back is whether the sending worked.

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
    id: str
    channel: str
    recipient: str
    subject_line: str
    body: str


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


def queued_messages(settings: RunnerSettings, limit: int = 50) -> list[QueuedMessage]:
    response = _post(settings, "queued_messages", {"p_limit": limit})
    if response.status_code >= 400:
        raise RuntimeError(f"queued_messages failed: {response.status_code}")

    return [
        QueuedMessage(
            id=row["id"],
            channel=row["channel"],
            recipient=row["recipient"],
            subject_line=row["subject_line"],
            body=row["body"],
        )
        for row in response.json() or []
    ]


def record_delivery(settings: RunnerSettings, *, message_id: str, sent: bool, detail: str) -> None:
    """Say whether one went.

    Takes no organization id, exactly as `record_provider_payment` does not: the row already
    knows which business it belongs to, so the caller supplies what happened and never where it
    lands.
    """
    response = _post(
        settings,
        "record_message_delivery",
        {"p_id": message_id, "p_sent": sent, "p_detail": detail},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"record_message_delivery failed: {response.status_code}")


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
