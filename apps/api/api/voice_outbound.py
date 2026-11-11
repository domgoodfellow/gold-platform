"""What the carrier should do when an agent's browser starts a call.

**This is the leg that was missing.** The first reception slice asked the carrier to ring a
customer and hold the line open, with nobody on the other end -- a telephone that rang and then
said nothing. The browser connects here instead, this puts the agent into a named room, and the
web app adds the customer to the same room as a participant.

**Both legs join a conference rather than dialling each other, which is the conference-call design.** Hold, transfer,
merge and a supervisor listening in are then each one operation on one participant, instead of
four features that cannot be added to a two-leg call without dropping it.

The agent's leg starts the room and ends it: when the person who made the call hangs up, the
conference closes rather than leaving a customer talking to nobody.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

import logging

from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_call_leg
from app.providers.twilio.voice import conference_twiml
from app.services.communications.carrier_callbacks import callback_refusal

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_voice_settings()
        if settings is None:
            self._reply(404, "text/plain; charset=utf-8", "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        params = form_params(body)

        # **Signed like every other callback**, and it matters more here rather than less: an
        # unverified request to this endpoint would let a stranger join a room a business is
        # holding a private conversation in.
        refusal = callback_refusal(
            settings,
            url=public_url(self.headers, self.path),
            params=params,
            signature=self.headers.get("x-twilio-signature"),
        )
        if refusal is not None:
            self._reply(refusal, "text/plain; charset=utf-8", "rejected")
            return

        # The room the web app already created and wrote onto the call row. Supplied by the
        # browser through the carrier rather than looked up here: this endpoint reads no tenant's
        # rows. It does tell the call which carrier telephone is the agent's, through the one
        # narrow door the voice integration holds, because the carrier names that telephone
        # only in this request and every later callback about the agent names nothing else.
        room = (params.get("Conference") or "").strip()
        if not room:
            self._reply(400, "text/plain; charset=utf-8", "rejected")
            return

        leg = (params.get("CallSid") or "").strip()
        if leg:
            try:
                record_call_leg(settings, conference_name=room, external_id=leg)
            except Exception:  # noqa: BLE001 - the agent must still be connected if our bookkeeping fails
                logger.exception("could not record the agent's leg")

        self._reply(
            200,
            "application/xml; charset=utf-8",
            conference_twiml(
                name=room,
                start_on_enter=True,
                end_on_exit=True,
                status_callback=public_url(self.headers, "/voice/status"),
            ),
        )

    def _reply(self, status: int, content_type: str, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
