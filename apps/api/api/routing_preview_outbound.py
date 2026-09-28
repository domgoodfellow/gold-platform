"""Resolving the outbound caller identity a candidate destination would actually use.

**The same resolver the dialer calls when a call is actually placed** — `resolveOutboundIdentity`
(this endpoint's TS caller) is used both to show a person what AUTO currently means and to decide
it for real, so the preview can never say one thing and the placed call do another.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_domain_settings
from app.domains.communications.routing import (
    OutboundIdentityRefused,
    RoutingLookupFailed,
    resolve_outbound_identity,
)


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_domain_settings()
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

        organization_id = (body.get("organization_id") or "").strip()
        member_id = (body.get("member_id") or "").strip()
        mode = (body.get("mode") or "auto").strip().lower()
        if not organization_id or not member_id or mode not in ("auto", "manual"):
            self._reply(400, {"error": "rejected"})
            return

        selected = body.get("selected_phone_number_id")
        selected = selected.strip() if isinstance(selected, str) and selected.strip() else None

        try:
            decision = resolve_outbound_identity(
                settings,
                token=caller.token,
                organization_id=organization_id,
                member_id=member_id,
                mode=mode,
                selected_phone_number_id=selected,
            )
        except OutboundIdentityRefused as failure:
            self._reply(422, {"error": str(failure), "reason": failure.reason})
            return
        except RoutingLookupFailed:
            self._reply(502, {"error": "routing data could not be read"})
            return

        self._reply(200, asdict(decision))

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
