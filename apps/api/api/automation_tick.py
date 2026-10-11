"""The clock, invoked on a schedule.

**The responsibility D2 lists first for this runtime, arriving in the milestone that finally has
something to ask about.** A scheduled evaluation asking *what is due* has nowhere to live in
Next.js: there is no persistent process, `apps/web` has no `api/` directory and may not grow one
(D26), and the answer must be reachable by a caller with no session at all.

Two things happen here and they are separate on purpose:

  * **What is due** — one call, and the whole scheduler is a query on the far side of it. There
    is no queue in this process, because D24 forbids anything that must survive between
    invocations from living anywhere but Postgres.
  * **What is waiting to be sent** — the queue that does exist, drained one message at a time so
    that one bad address cannot stop the rest.

**Nothing here decides anything.** It cannot: `automation_runner` holds no grant on any table,
so what comes back is an address and the finished words a business wrote, and what can go back
is whether the sending worked.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.channels import Message
from app.channels.registry import sender_for, unconfigured_reason
from app.conditions.registry import conditions_provider
from app.core.config import load_integration_settings, load_runner_settings
from app.core.runner import (
    QueuedMessage,
    places_to_watch,
    queued_messages,
    record_delivery,
    record_external_readings,
    run_due_automations,
)


def _hour(moment: str) -> str:
    """The hour a moment falls in, as a comparable string.

    Both sides are already UTC — the database truncates and the provider is asked for UTC — so
    this is string trimming rather than arithmetic, and there is no timezone decision hiding in
    it. A tenant's own zone never enters into this: an instant is absolute (I9).
    """
    return moment.replace("Z", "").replace("+00:00", "")[:13]


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_GET(self) -> None:  # noqa: N802 - Vercel's scheduler issues GET
        self._tick()

    def do_POST(self) -> None:  # noqa: N802 - and a person testing it reaches for POST
        self._tick()

    def _tick(self) -> None:
        settings = load_runner_settings()
        if settings is None:
            # Nothing configured. Same answer the payment webhook gives: this endpoint does not
            # exist on this deployment.
            self._reply(404, {"error": "not found"})
            return

        # A shared secret rather than a signature, because the caller is the host's own
        # scheduler rather than a third party with a signing key. Compared in full length —
        # there is no early return that could be timed.
        presented = self.headers.get("authorization") or ""
        if presented != f"Bearer {settings.cron_secret}":
            self._reply(401, {"error": "rejected"})
            return

        # **Fetch first, then run.** A reading taken after the rules were evaluated is a
        # reading that waits a whole tick to matter, and the point of a weather rule is
        # that it acts on what has just changed.
        readings = self._fetch(settings)
        ran = run_due_automations(settings)
        sent, failed, held = self._drain(settings)
        tools = self._tools()

        # A count of each, and no tenant's name anywhere. This response goes into a hosting
        # provider's log, which is outside every boundary this platform draws.
        self._reply(
            200,
            {"read": readings, "ran": ran, "sent": sent, "failed": failed, "held": held, "tools": tools},
        )

    def _fetch(self, settings) -> int:
        """Ask about the places this tenant's rules are watching.

        Nothing here decides anything: it writes down what somebody else said, in the unit they
        said it in. Which number matters, in which unit, and what to do about it are three
        things the business wrote down, and all three are read in Postgres.
        """
        provider = conditions_provider()
        if provider is None:
            return 0

        # Grouped so one place is asked about once for every metric a rule watches there, rather
        # than once per rule. A business with four wind rules on one site is one request.
        metrics: dict[tuple[str, float, float], set[str]] = {}
        # **And the hours that are actually read.** A provider answers with a week of hourly
        # numbers and a rule looks at one of them — the hour its job starts in. Keeping the rest
        # would be around fifty thousand rows a day per place, all of them unreachable by every
        # query in the schema.
        hours: dict[tuple[str, str], set[str]] = {}

        for place in places_to_watch(settings):
            key = (place.location_id, place.latitude, place.longitude)
            metrics.setdefault(key, set()).add(place.metric)
            hours.setdefault((place.location_id, place.metric), set()).add(
                _hour(place.needed_at)
            )

        written = 0
        for (location_id, latitude, longitude), wanted in metrics.items():
            try:
                readings = provider.readings(
                    latitude=latitude, longitude=longitude, metrics=tuple(sorted(wanted))
                )
            except Exception:  # noqa: BLE001 - a provider being down is not a failure to record
                continue

            keep = [
                {
                    "metric": reading.metric,
                    "value": reading.value,
                    "unit": reading.unit,
                    "applies_at": reading.applies_at.isoformat() + "Z",
                }
                for reading in readings
                if _hour(reading.applies_at.isoformat())
                in hours.get((location_id, reading.metric), set())
            ]

            # One call carrying all of them, which is the difference between this returning and
            # this timing out.
            written += record_external_readings(
                settings, location_id=location_id, readings=keep
            )

        return written

    def _tools(self) -> dict:
        """Tool calls automations have queued, and the execution record's upkeep.

        Run by the integration runtime (its own settings and role), through the executor an agent's tool
        calls use. A deployment without those settings simply has none, and says so.
        """
        from app.services.integrations.actions import run_queued_actions, tidy

        integration = load_integration_settings()
        if integration is None:
            return {"configured": False}
        try:
            run = run_queued_actions(integration)
            tidy(integration)
        except Exception:  # noqa: BLE001 - one failing runtime must not take the clock down with it
            return {"configured": True, "error": True}
        return {"configured": True, "ran": run.ran, "failed": run.failed, "retried": run.retried}

    def _drain(self, settings) -> tuple[int, int, int]:
        sent = 0
        failed = 0
        held = 0

        for message in queued_messages(settings):
            outcome = self._send(message)

            if outcome is None:
                # The provider is unreachable rather than unwilling. Left queued, so the next
                # tick tries again — recording a failure here would tell a business its message
                # was refused when nobody had yet seen it.
                held += 1
                continue

            record_delivery(
                settings,
                message_id=message.id,
                sent=outcome.ok,
                detail=outcome.detail,
            )
            if outcome.ok:
                sent += 1
            else:
                failed += 1

        return sent, failed, held

    def _send(self, message: QueuedMessage):
        sender = sender_for(message.channel)
        if sender is None:
            # A channel this deployment cannot send on. Recorded as a failure with a sentence
            # saying whose problem it is — not silence, which is what D31 exists to forbid.
            from app.channels import Sent

            return Sent(ok=False, detail=unconfigured_reason(message.channel))

        try:
            return sender.send(
                Message(
                    recipient=message.recipient,
                    subject_line=message.subject_line,
                    # Verbatim. Nothing in this process may add to what a business wrote.
                    body=message.body,
                )
            )
        except Exception:  # noqa: BLE001 - the provider being down is not this platform's error
            return None

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
