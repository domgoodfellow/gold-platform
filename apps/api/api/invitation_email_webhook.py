"""Resend calling in about one invitation email it was asked to send.

**The same shape `stripe_webhook.py` holds, one vendor over.** The signature check is the
integration's, because "did this really come from Resend" is an entirely Resend-specific question;
the write is one SECURITY DEFINER function that derives the organization and invitation itself from
the provider's own message id; the authority it writes with is a Postgres role holding no table
grant at all. A bad signature, an unparseable body, and an event this platform does not track all
produce the same terse answer, and none of them is distinguishable from the others to the caller.

Vercel's Python runtime routes a file under `api/` to a path (D24). No framework, one file, one
route.
"""

from __future__ import annotations

import hashlib
import json
from http.server import BaseHTTPRequestHandler

from app.core.config import load_invitation_email_webhook_settings
from app.core.db import record_invitation_delivery_event
from app.providers.resend.webhook import SignatureInvalid, parse_event, verify_signature


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_invitation_email_webhook_settings()
        if settings is None:
            # Nothing configured. A deployment that never set up Resend delivery callbacks has no
            # endpoint to hear from, and 404 is the honest answer: this does not exist here.
            self._reply(404, "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        # The **raw** bytes, read once and never parsed first -- a signature is over bytes, and
        # anything that re-serialises before verifying checks a signature against a body nobody sent.
        raw = self.rfile.read(length)

        try:
            verify_signature(
                secret=settings.signing_secret,
                svix_id=self.headers.get("svix-id"),
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

        event = parse_event(body if isinstance(body, dict) else {})
        if event is None:
            # A genuine event this platform does not track. 200, so Resend stops retrying
            # something that was never going to be recorded.
            self._reply(200, "ignored")
            return

        # The retry guard: the same bytes delivered twice hash the same, so a repeated callback is
        # a no-op at the database rather than a second row (record_invitation_delivery_event's own
        # `on conflict`).
        payload_hash = hashlib.sha256(raw).hexdigest()

        recorded = record_invitation_delivery_event(
            settings,
            provider_message_id=event["message_id"],
            state=event["state"],
            detail=event["detail"],
            payload=body,
            payload_hash=payload_hash,
        )

        # None is a verified event about a message id this platform has no record of sending.
        # Also 200, for the same reason stripe_webhook.py gives.
        self._reply(200, "recorded" if recorded else "unknown")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
