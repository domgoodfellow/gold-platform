"""Somebody ringing one of this platform's numbers.

**The one of the five that cannot be finished yet, and it declines rather than improvising.**
Routing an inbound call means answering *which business owns this number* and then *who here
should take it*, and neither has anywhere to be looked up: the deployment holds a single number
in an environment variable, and a number inventory is the slice after this one. An endpoint that
guessed would be guessing about a stranger's telephone call.

**It exists now, signed, because the URL has to be stable before it is useful.** A carrier's
console is configured per number, by a person, and rewiring every number later is exactly the
kind of manual step that gets half done. The address is settled here; what it answers changes
once numbers are rows.

**It declines rather than speaking**, because the words a caller hears belong to the business
(I24) and this platform has not been given any -- it does not even know whose number was rung.
A sentence invented here would be the platform putting words in a business's mouth, which is the
thing `public-profile.test.ts` fails the build over one surface across.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.providers.twilio.voice import verify_signature

# Not `<Hangup/>`: a rejected call is one the network never answered, so the caller is not
# billed and hears their own carrier's tone rather than silence from us. It is the honest signal
# for a number that is not yet configured to do anything.
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

        self._reply(200, "application/xml; charset=utf-8", DECLINE)

    def _reply(self, status: int, content_type: str, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
