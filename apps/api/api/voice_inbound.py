"""Somebody ringing one of this platform's numbers.

**Recorded first, then declined.** A business is entitled to learn it was rung and by whom, so the
call is written down before anything is said to the carrier: the business is the one whose number
was dialled (derived inside the database from that number, never supplied), the caller is matched to
a customer only when exactly one holds the number, and an unknown or withheld caller is a call all
the same. A number no active business holds records nothing and is declined.

**It still declines, because routing a live call is not built.** Deciding *who here should take it*
is the routing slice's, and the words a caller hears belong to the business, which has not
been asked. Until a route is wired to this request the honest answer is the carrier's own
busy signal, and the honest record is a call that was missed. A recording failure never changes the
answer to the carrier: the caller hears the same thing whether or not this deployment could write
it down.

**The address is stable because a carrier's console is configured per number, by a person.**
"""

from __future__ import annotations

import logging
from http.server import BaseHTTPRequestHandler

from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_inbound_call
from app.providers.twilio.voice import payload_hash, verify_signature

# Not `<Hangup/>`: a rejected call is one the network never answered, so the caller is not
# billed and hears their own carrier's tone rather than silence from us. It is the honest signal
# for a number that is not yet configured to do anything.
logger = logging.getLogger(__name__)

DECLINE = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>'


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_voice_settings()
        if settings is None:
            self._reply(404, "text/plain; charset=utf-8", "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        params = form_params(body)

        if not verify_signature(
            url=public_url(self.headers, self.path),
            params=params,
            signature=self.headers.get("x-twilio-signature"),
            auth_token=settings.twilio_auth_token,
        ):
            self._reply(403, "text/plain; charset=utf-8", "rejected")
            return

        external_id = (params.get("CallSid") or "").strip()
        called = (params.get("To") or "").strip()
        if external_id and called:
            try:
                record_inbound_call(
                    settings,
                    external_id=external_id,
                    to_number=called,
                    from_number=(params.get("From") or "").strip(),
                    payload=params,
                    payload_hash=payload_hash(params),
                )
            except Exception:  # noqa: BLE001 - the caller's answer must not depend on our bookkeeping
                logger.exception("could not record an inbound call")

        self._reply(200, "application/xml; charset=utf-8", DECLINE)

    def _reply(self, status: int, content_type: str, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
