"""An operator writing up how a call went.

**The first Communications/Voice endpoint driven by a person rather than a carrier.** The other
four `voice_*` files here answer Twilio; this one answers `apps/web` on behalf of somebody who
just hung up. Same authorization story as `crm_change_customer_stage.py` and `ai_ask.py`:
`record_call_outcome` is `security invoker`, so `calls_update` (capability `call.place`) is what
actually decides the write, under the caller's own forwarded token (D17, D34).

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler

from app.core.config import load_domain_settings
from app.domains.communications.voice.wrap_up import WrapUpCallCommand, wrap_up_call
from app.domains.errors import DomainError


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_domain_settings()
        if settings is None:
            self._reply(404, {"error": "not found"})
            return

        presented = self.headers.get("authorization") or ""
        if not presented.startswith("Bearer "):
            self._reply(401, {"error": "rejected"})
            return

        length = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._reply(400, {"error": "rejected"})
            return

        organization_id = (body.get("organization_id") or "").strip()
        call_id = (body.get("call_id") or "").strip()
        outcome_id = body.get("outcome_id")
        outcome_id = outcome_id.strip() if isinstance(outcome_id, str) and outcome_id.strip() else None
        note = body.get("note") or ""
        duration_seconds = body.get("duration_seconds")
        status = body.get("status")
        status = status.strip() if isinstance(status, str) and status.strip() else None

        if not organization_id or not call_id:
            self._reply(400, {"error": "rejected"})
            return

        if duration_seconds is not None and not isinstance(duration_seconds, int):
            self._reply(400, {"error": "rejected"})
            return

        try:
            result = wrap_up_call(
                settings,
                token=presented.removeprefix("Bearer "),
                command=WrapUpCallCommand(
                    organization_id=organization_id,
                    call_id=call_id,
                    outcome_id=outcome_id,
                    note=str(note).strip(),
                    duration_seconds=duration_seconds,
                    status=status,
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
