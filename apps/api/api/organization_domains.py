"""A business connecting, checking or removing its own custom domain.

**The hosting credential never leaves this runtime.** The caller's own token proves who is asking
(`require_caller`); the command then proves that person may manage this business's domains by
letting RLS answer, and only after that reads GildOps' hosting credential through a machine role
no human session can wear. The response carries GildOps' own states and the DNS records to
publish -- never the credential, never the provider's raw answer.

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_integration_settings, load_provider_operations_settings
from app.errors import DomainError
from app.services.web_delivery.operations import run_domain_command


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
            result = run_domain_command(
                settings,
                token=caller.token,
                command=str(body.get("command") or "").strip(),
                organization_id=str(body.get("organization_id") or "").strip(),
                domain_id=str(body.get("domain_id") or "").strip(),
                # `None` on a deployment with no OAuth connectors configured: the automated DNS
                # bridge is simply unavailable then, and the manual path is unaffected.
                dns_settings=load_integration_settings(),
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
