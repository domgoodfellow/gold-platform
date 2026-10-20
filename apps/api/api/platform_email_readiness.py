"""Platform staff asking whether GildOps' own invitation email can be sent from this runtime.

**Read only, and nothing secret in the answer.** The caller's token must belong to platform staff
(the database decides); the answer names missing settings and states, never values or keys.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_provider_operations_settings
from app.errors import DomainError
from app.services.platform_email.readiness import platform_email_readiness


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_provider_operations_settings()
        if settings is None:
            # Like every endpoint here: a deployment without its database settings does not offer it.
            self._reply(404, {"error": "not found"})
            return
        try:
            caller = require_caller(self.headers, supabase_url=settings.supabase_url, supabase_publishable_key=settings.supabase_publishable_key)
        except AuthError as failure:
            self._reply(failure.status, {"error": failure.message})
            return
        try:
            result = platform_email_readiness(settings, token=caller.token)
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
