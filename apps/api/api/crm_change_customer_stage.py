
"""An operator moving a customer along the pipeline.

**The first CRM endpoint, and the same authorization story `ai_ask.py` already tells.** There is
no role for this handler, no grant to check and no organization to trust: `change_customer_stage`
is `security invoker`, so what a caller may move is exactly what `customers_update` (capability
`customer.update`) already lets their session touch, decided by RLS the ordinary way (the tenant-isolation rule, the AI-tool architecture,
extended from a read to a write). This handler authenticates nothing itself, because there is
nothing it could usefully check that Postgres does not check again a moment later.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler

from app.auth import AuthError, require_caller
from app.core.config import load_domain_settings
from app.domains.crm.stages import ChangeCustomerStageCommand, change_customer_stage
from app.errors import DomainError


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
        customer_id = (body.get("customer_id") or "").strip()
        stage_id = body.get("stage_id")
        stage_id = stage_id.strip() if isinstance(stage_id, str) and stage_id.strip() else None

        if not organization_id or not customer_id:
            self._reply(400, {"error": "rejected"})
            return

        try:
            result = change_customer_stage(
                settings,
                token=caller.token,
                command=ChangeCustomerStageCommand(
                    organization_id=organization_id,
                    customer_id=customer_id,
                    stage_id=stage_id,
                ),
            )
        except DomainError as failure:
            self._reply(failure.status, {"error": str(failure), "code": failure.code})
            return

        self._reply(200, asdict(result))

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
