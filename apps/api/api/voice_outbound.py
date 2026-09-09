"""What the carrier should do when an agent's browser starts a call.

**This is the leg that was missing.** The first reception slice asked the carrier to ring a
customer and hold the line open, with nobody on the other end -- a telephone that rang and then
said nothing. The browser connects here instead, this puts the agent into a named room, and the
web app adds the customer to the same room as a participant.

**Both legs join a conference rather than dialling each other, which is D38.** Hold, transfer,
merge and a supervisor listening in are then each one operation on one participant, instead of
four features that cannot be added to a two-leg call without dropping it.

The agent's leg starts the room and ends it: when the person who made the call hangs up, the
conference closes rather than leaving a customer talking to nobody.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from apps.api.api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.integrations.twilio.voice import conference_twiml, verify_signature


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
        if not verify_signature(
            url=public_url(self.headers, self.path),
            params=params,
            signature=self.headers.get("x-twilio-signature"),
            auth_token=settings.twilio_auth_token,
        ):
            self._reply(403, "text/plain; charset=utf-8", "rejected")
            return

        # The room the web app already created and wrote onto the call row. Supplied by the
        # browser through the carrier rather than looked up here, because this endpoint holds no
        # database identity of its own and must not grow one: a TwiML responder that could read
        # a tenant's rows would be a second authorization surface.
        room = (params.get("Conference") or "").strip()
        if not room:
            self._reply(400, "text/plain; charset=utf-8", "rejected")
            return

        self._reply(
            200,
            "application/xml; charset=utf-8",
            conference_twiml(name=room, start_on_enter=True, end_on_exit=True),
        )

    def _reply(self, status: int, content_type: str, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
