"""The carrier delivering a text message this platform received.

**Signature verified the same way a voice callback is** (`app.providers.twilio.voice`'s
`verify_signature` is carrier-vocabulary, not voice-vocabulary — messaging reuses it rather than
duplicating the HMAC check).

**Keyword handling happens here, before anything else records the message.** STOP/START/HELP are
the one behaviour a carrier expects an SMS platform to honour regardless of what a business has
configured (the messaging rules' restated point: a business cannot bypass suppression, and neither can silence
on this endpoint).
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_inbound_message, record_message_suppression
from app.services.communications.carrier_callbacks import callback_refusal

STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
START_WORDS = {"start", "yes", "unstop"}


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_voice_settings()
        if settings is None:
            self._reply(404, "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        params = form_params(body)

        refusal = callback_refusal(
            settings,
            url=public_url(self.headers, self.path),
            params=params,
            signature=self.headers.get("x-twilio-signature"),
            allow_deployment_account=True,
        )
        if refusal is not None:
            self._reply(refusal, "rejected")
            return

        to_number = (params.get("To") or "").strip()
        from_number = (params.get("From") or "").strip()
        message_body = params.get("Body") or ""
        external_id = (params.get("MessageSid") or params.get("SmsMessageSid") or "").strip()
        if not to_number or not from_number or not external_id:
            self._reply(200, "ignored")
            return

        keyword = message_body.strip().lower()
        if keyword in STOP_WORDS or keyword in START_WORDS:
            record_message_suppression(settings, to_number=to_number, external_number=from_number, opted_out=keyword in STOP_WORDS)

        recorded = record_inbound_message(settings, to_number=to_number, from_number=from_number, external_id=external_id, body=message_body)
        self._reply(200, "recorded" if recorded else "ignored")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
