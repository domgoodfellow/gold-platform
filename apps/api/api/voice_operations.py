"""A signed-in person placing and controlling their business's calls.

**The credential never leaves this runtime.** The caller's own token proves who is asking
(`require_caller`); `call_operations` then lets the database answer, under that same token,
whether this person may use this business's telephone, and only after that reads the business's
own calling credential through a machine role no human session can wear.

**The carrier is told to report to this runtime's own address**, taken from how this request
arrived (or `TELEPHONY_CALLBACK_URL` where a tunnel stands in front of a local runtime) -- never
from the request body.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler

from api.voice_status import public_url
from app.auth import AuthError, require_caller
from app.core.config import load_provider_operations_settings
from app.errors import DomainError
from app.services.communications.call_operations import CallCommand, open_recording, operate


def report_base(headers) -> str:
    configured = (os.environ.get("TELEPHONY_CALLBACK_URL") or "").rstrip("/")
    return configured or public_url(headers, "").rstrip("/")


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_provider_operations_settings()
        if settings is None:
            self._reply(404, {"error": "not found"})
            return

        try:
            caller = require_caller(
                self.headers,
                supabase_url=settings.supabase_url,
                supabase_publishable_key=settings.supabase_publishable_key,
            )
        except AuthError as failure:
            self._reply(failure.status, {"error": failure.message})
            return

        length = int(self.headers.get("content-length") or 0)
        if length > 65536:
            self._reply(413, {"error": "rejected"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._reply(400, {"error": "rejected"})
            return
        if not isinstance(body, dict):
            self._reply(400, {"error": "rejected"})
            return

        organization_id = str(body.get("organization_id") or "").strip()
        operation = str(body.get("operation") or "").strip()
        arguments = body.get("arguments") if isinstance(body.get("arguments"), dict) else {}

        try:
            if operation == "recording":
                recording = open_recording(
                    settings,
                    token=caller.token,
                    organization_id=organization_id,
                    call_id=str(arguments.get("call_id") or "").strip(),
                )
                self._stream(recording)
                return

            result = operate(
                settings,
                token=caller.token,
                command=CallCommand(organization_id=organization_id, operation=operation, arguments=arguments),
                report_to=report_base(self.headers),
            )
        except DomainError as failure:
            self._reply(failure.status, {"error": str(failure), "code": failure.code})
            return

        self._reply(200, result)

    def _stream(self, recording) -> None:
        try:
            self.send_response(200)
            self.send_header("content-type", recording.content_type)
            if recording.length:
                self.send_header("content-length", recording.length)
            # A recording is a private conversation. Nothing between here and the person keeps it.
            self.send_header("cache-control", "private, no-store")
            self.end_headers()
            for chunk in recording.chunks:
                self.wfile.write(chunk)
        finally:
            recording.close()

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
