"""An organization's customer on GOLD's own billing account.

**The processor key and the provisioner role never leave this runtime.** The caller's own token
proves who is asking (`require_caller`); the database then decides, as that person, whether they
may manage this business's billing. Only after that does this runtime ask the processor, and only
this runtime may record what the processor returned. The response carries the customer reference
and the environment -- never a credential.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_platform_billing_provisioning_settings
from app.errors import DomainError
from app.services.platform_billing.customers import EnsureCustomerCommand, ensure_billing_customer


def _optional_text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:limit] if text else None


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_platform_billing_provisioning_settings()
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
            result = ensure_billing_customer(
                settings,
                token=caller.token,
                caller_id=caller.user_id,
                command=EnsureCustomerCommand(
                    organization_id=str(body.get("organization_id") or ""),
                    email=_optional_text(body.get("email"), 320),
                    name=_optional_text(body.get("name"), 200),
                ),
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
