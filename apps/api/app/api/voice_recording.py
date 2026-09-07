"""The carrier saying where the audio ended up.

**A separate route from the status callback rather than a branch inside it**, because
`app/api/` is one file one route and because the two carry different payloads that mean
different things. It is also the endpoint everything downstream waits on: no recording, no
transcript; no transcript, no summary, no objection detection, and nothing to assist a person
with while they are still talking.

What lands on the call is the carrier's address for the audio, not the audio. Fetching the
bytes into this platform's own storage is a separate act with its own failure modes, and the
column says so.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from app.api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_call_event
from app.integrations.twilio.voice import (
    payload_hash,
    recording_download_url,
    recording_report,
    verify_signature,
)


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

        report = recording_report(params)
        if report is None:
            self._reply(200, "ignored")
            return

        recorded = record_call_event(
            settings,
            external_id=report.external_id,
            source=report.source,
            raw_status=report.raw_status,
            status=None,
            duration_seconds=None,
            # The audio itself rather than the page about it. Knowing the difference is knowing
            # something about one vendor, which is why the adapter does it and this does not.
            recording_url=recording_download_url(report.recording_url or ""),
            payload=params,
            payload_hash=payload_hash(params),
        )

        self._reply(200, "recorded" if recorded else "ignored")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
