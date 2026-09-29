"""The carrier reporting what happened to a text message it was asked to deliver.

Same shape as `voice_status.py`: signed, idempotent by construction (`record_message_status`
finds the row by the carrier's own external id, which a retried callback names identically), and
a retry or an unknown message answers exactly the same as a genuinely new one.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_message_status
from app.providers.twilio.voice import verify_signature

_FAILURE_STATUSES = {"failed", "undelivered"}


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_voice_settings()
        if settings is None:
            self._reply(404, "not found")
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
            self._reply(403, "rejected")
            return

        external_id = (params.get("MessageSid") or params.get("SmsSid") or "").strip()
        status = (params.get("MessageStatus") or "").strip().lower()
        if not external_id or not status:
            self._reply(200, "ignored")
            return

        failure_reason = None
        if status in _FAILURE_STATUSES:
            error_code = params.get("ErrorCode")
            failure_reason = f"provider error {error_code}" if error_code else "delivery failed"

        recorded = record_message_status(settings, external_id=external_id, status=status, failure_reason=failure_reason)
        self._reply(200, "recorded" if recorded else "ignored")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
