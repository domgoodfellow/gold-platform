"""The email provider calling in about a business's own mail: delivery events and arriving messages.

**The same shape `invitation_email_webhook.py` holds, for a different purpose and a different
secret.** The signature is checked over the raw bytes before a single field is read; the write is
one SECURITY DEFINER function that derives the business itself (from the provider's own message id
for a delivery event, from the receiving address for an arriving message); the authority it writes
with is a Postgres role (`tenant_email_webhook`) holding no table grant. A bad signature, an
unparseable body and an event this platform does not track are answered as tersely as each other.

An arriving message is the one case where a verified callback is not enough to answer 200: its body
has to be fetched from the provider, and if that fails the answer is a 5xx so the provider retries
rather than the message being lost. Anything already recorded is acknowledged without being
recorded again (`record_email_event` and `record_inbound_email` are both idempotent on the
provider's own identifiers).

Vercel's Python runtime routes a file under `api/` to a path. No framework, one file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.core.config import load_tenant_email_webhook_settings
from app.core.db import record_email_event
from app.providers.resend import email as provider
from app.providers.resend.webhook import SignatureInvalid, parse_tenant_event, verify_signature
from app.services.tenant_email.inbound import handle_received

# The provider this ingress belongs to, by the key its provider account and bindings carry.
PROVIDER_KEY = "resend"


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_tenant_email_webhook_settings()
        if settings is None:
            self._reply(404, "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        # The raw bytes, read once and never parsed first: a signature is over bytes.
        raw = self.rfile.read(length)
        svix_id = self.headers.get("svix-id")

        try:
            verify_signature(
                secret=settings.signing_secret,
                svix_id=svix_id,
                svix_timestamp=self.headers.get("svix-timestamp"),
                svix_signature=self.headers.get("svix-signature"),
                body=raw,
            )
        except (SignatureInvalid, ValueError):
            self._reply(400, "rejected")
            return

        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._reply(400, "rejected")
            return

        event = parse_tenant_event(body if isinstance(body, dict) else {})
        if event is None:
            # A genuine event this platform does not track: 200, so the provider stops retrying.
            self._reply(200, "ignored")
            return

        # The provider's own delivery id is the stable identity of one callback attempt (proven
        # non-empty by `verify_signature`), which is what makes a retry the same fact.
        event_id = str(svix_id)

        try:
            if event["kind"] == "received":
                outcome = handle_received(settings, provider, provider_key=PROVIDER_KEY, event=event, event_id=event_id)
                self._reply(200, outcome)
                return

            recorded = record_email_event(
                settings,
                provider_message_id=event["message_id"],
                event_type=event["type"],
                provider_event_id=event_id,
                detail=event["detail"],
                payload=body,
                event_at=event["event_at"],
            )
        except Exception:  # noqa: BLE001 - a 5xx is the provider's cue to try again
            self._reply(500, "retry")
            return

        # None: a duplicate, or about a message this platform has no record of sending. Both 200.
        self._reply(200, "recorded" if recorded else "ignored")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
