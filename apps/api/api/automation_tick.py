"""The clock, invoked on a schedule.

**The responsibility the web/API runtime split lists first for this runtime, arriving in the milestone that finally has
something to ask about.** A scheduled evaluation asking *what is due* has nowhere to live in
Next.js: there is no persistent process, `apps/web` has no `api/` directory and may not grow one
, and the answer must be reachable by a caller with no session at all.

Two things happen here and they are separate on purpose:

  * **What is due** — one call, and the whole scheduler is a query on the far side of it. There
    is no queue in this process, because the no-queue scheduling rule forbids anything that must survive between
    invocations from living anywhere but Postgres.
  * **What is waiting to be sent** — the queue that does exist, drained one message at a time so
    that one bad address cannot stop the rest. Each delivery is claimed once before it is sent. An
    email goes out from the business's own verified sender, resolved by the database and pinned to
    the provider account that holds its domain, never from an address of this deployment's.

**Nothing here decides anything.** It cannot: `automation_runner` holds no grant on any table,
so what comes back is an address and the finished words a business wrote, and what can go back
is whether the sending worked.
"""

from __future__ import annotations

import json
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler

from app.channels import Message
from app.channels.registry import sender_for, unconfigured_reason
from app.conditions.registry import conditions_provider
from app.core import db
from app.core.config import load_integration_settings, load_provider_operations_settings, load_runner_settings
from app.core.runner import (
    QueuedMessage,
    claim_deliveries,
    finish_delivery,
    places_to_watch,
    record_external_readings,
    run_due_automations,
)
from app.providers.providers import tenant_email_for

# Recorded on the Automations screen; neither names a provider or this deployment's configuration.
EMAIL_NOT_SET_UP = "Email sending is not set up on this deployment yet."
EMAIL_ACCOUNT_UNAVAILABLE = "Email sending for this business's sender address is unavailable on this platform right now."


def _hour(moment: str) -> str:
    """The hour a moment falls in, as a comparable string.

    Both sides are already UTC — the database truncates and the provider is asked for UTC — so
    this is string trimming rather than arithmetic, and there is no timezone decision hiding in
    it. A tenant's own zone never enters into this: an instant is absolute.
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
        # Only needed to read the provider account a business's email is pinned to.
        providers = load_provider_operations_settings()

        for message in claim_deliveries(settings):
            if message.channel == "email":
                outcome, external_id, detail = self._send_email(message, providers)
            else:
                outcome, external_id, detail = self._send_text(message)

            # Every claimed delivery is finished, including one that goes back to the queue: an
            # unreachable provider is "try again next tick", never a refusal a business must fix.
            finish_delivery(settings, message_id=message.id, outcome=outcome, external_id=external_id, detail=detail)
            if outcome == "accepted":
                sent += 1
            elif outcome == "retry":
                held += 1
            else:
                failed += 1

        return sent, failed, held

    def _send_email(self, message: QueuedMessage, providers) -> tuple[str, str | None, str | None]:
        """A business's email, from the sender the database resolved and through the account that
        holds its domain. No fallback: without that account's credential nothing is sent, and the
        deployment's own key or address is never used in its place."""
        provider = tenant_email_for(message.provider_key) if message.provider_key else None
        if provider is None or providers is None or not message.provider_account_id or not message.from_address:
            return "failed", None, EMAIL_NOT_SET_UP
        try:
            credential = db.read_provider_account_credential(providers, account_id=message.provider_account_id)
        except Exception:  # noqa: BLE001 - not reading it is "try again", not a refusal
            return "retry", None, None
        if not credential or not credential.get("secret"):
            return "failed", None, EMAIL_ACCOUNT_UNAVAILABLE

        result = provider.send_tenant_email(
            api_key=credential["secret"],
            # The delivery's own id, so a retry after a lost answer is the same send, not a second one.
            idempotency_key=message.id,
            sender=formataddr((message.from_name or "", message.from_address)),
            to=[message.recipient],
            subject=message.subject_line,
            # Verbatim. Nothing in this process may add to what a business wrote.
            text=message.body,
            html=None,
            in_reply_to=None,
            references=[],
            attachments=[],
            reply_to=message.reply_to,
            # Lets a delivery report name this delivery even if the answer to this send is lost.
            tags=[{"name": "gildops_delivery", "value": message.id}],
        )
        if result["ok"]:
            return "accepted", result["external_id"], None
        if result.get("uncertain"):
            # An earlier attempt under this delivery's key may have been sent: never sent again.
            return "uncertain", None, result["detail"]
        if result["retryable"]:
            return "retry", None, None
        return "rejected", None, result["detail"]

    def _send_text(self, message: QueuedMessage) -> tuple[str, str | None, str | None]:
        sender = sender_for(message.channel)
        if sender is None:
            # A channel this deployment cannot send on. Recorded as a failure with a sentence
            # saying whose problem it is — not silence, which is what the no-dead-end rule exists to forbid.
            return "failed", None, unconfigured_reason(message.channel)

        try:
            outcome = sender.send(
                Message(
                    recipient=message.recipient,
                    subject_line=message.subject_line,
                    # Verbatim. Nothing in this process may add to what a business wrote.
                    body=message.body,
                )
            )
        except Exception:  # noqa: BLE001 - the provider being down is not this platform's error
            return "retry", None, None
        return ("accepted", None, None) if outcome.ok else ("rejected", None, outcome.detail)

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
