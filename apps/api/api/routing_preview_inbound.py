"""Testing a route's logical result without placing a real call.

**Calls the exact function a live inbound call will (once that slice wires the webhook to it) —
never a second, weaker copy.** `resolve_inbound_route` reads Postgres under this caller's own
forwarded token, so a preview can see only what the operator asking could already see (D17).

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_domain_settings
from app.domains.communications.routing import RoutingLookupFailed, resolve_inbound_route


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
        if not organization_id:
            self._reply(400, {"error": "rejected"})
            return

        number_id = body.get("number_id")
        number_id = number_id.strip() if isinstance(number_id, str) and number_id.strip() else None
        from_number = body.get("from_number")
        from_number = from_number.strip() if isinstance(from_number, str) and from_number.strip() else None
        at_raw = body.get("at")

        at = None
        if isinstance(at_raw, str) and at_raw.strip():
            try:
                at = datetime.fromisoformat(at_raw.replace("Z", "+00:00"))
            except ValueError:
                self._reply(400, {"error": "rejected"})
                return

        try:
            decision = resolve_inbound_route(
                settings,
                token=caller.token,
                organization_id=organization_id,
                number_id=number_id,
                from_number=from_number,
                at=at,
            )
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
