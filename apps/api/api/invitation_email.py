"""A signed-in person's own action sending or resending one of their business's invitations.

**No credential leaves this runtime, and no free text enters it.** The caller's own token proves
who is asking (`require_caller`); `app.services.platform_email` then proves they may act on this
exact invitation by letting RLS answer, resolves GildOps' own Resend credential through a machine
role no human session can wear, and builds the email itself from a fixed template -- never from a
subject or body this handler received.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_provider_operations_settings
from app.errors import DomainError
from app.services.platform_email.operations import send_invitation_email


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
            result = send_invitation_email(
                settings,
                token=caller.token,
                organization_id=str(body.get("organization_id") or "").strip(),
                invitation_id=str(body.get("invitation_id") or "").strip(),
                link=str(body.get("link") or "").strip(),
            )
        except DomainError as failure:
            self._reply(failure.status, {"error": str(failure), "code": failure.code})
            return

        self._reply(200, {"sent": result["sent"], "external_id": result["external_id"]})

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
