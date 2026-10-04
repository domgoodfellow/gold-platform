"""A business's person sending one queued email.

**The request names a message, and nothing else.** `queue_outbound_email` already decided, in the
database and under this person's own session, who it is from, who it goes to and what it says. The
caller's own token proves who is asking (`require_caller`); the command then lets RLS answer whether
that person may see this message, and only after that reads the provider credential through a machine
role no human session can wear. The response carries GildOps' own state of the message, never the
credential and never the provider's raw answer.

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_provider_operations_settings
from app.errors import DomainError
from app.services.tenant_email.operations import send_queued_email


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
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._reply(400, {"error": "rejected"})
            return
        if not isinstance(body, dict):
            self._reply(400, {"error": "rejected"})
            return

        try:
            result = send_queued_email(
                settings,
                token=caller.token,
                organization_id=str(body.get("organization_id") or "").strip(),
                message_id=str(body.get("message_id") or "").strip(),
            )
        except DomainError as failure:
            self._reply(failure.status, {"error": str(failure), "code": failure.code})
            return

        self._reply(200, result)

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
