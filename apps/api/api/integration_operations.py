"""A signed-in person connecting, checking or disconnecting their business's own outside app.

**The credential never leaves this runtime.** The caller's own token proves who is asking
(`require_caller`); `operate` proves that person may manage integrations for that business by
letting RLS answer, and only then touches the stored credential through a machine role no human
session can wear. The response carries the operation's result -- never a token.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_integration_settings
from app.errors import DomainError
from app.services.integrations.operations import operate


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_integration_settings()
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

        arguments = body.get("arguments")
        try:
            result = operate(
                settings,
                caller,
                operation=str(body.get("operation") or "").strip(),
                arguments=arguments if isinstance(arguments, dict) else {},
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
