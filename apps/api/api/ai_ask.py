"""An operator asking the system a question.

**The third endpoint here, and the first that serves a person.** The other two are a processor
calling in and a scheduler turning the clock, both with nobody present. This one is called by
`apps/web` on behalf of somebody who is sitting there, and every read it performs happens under
that person's own access token.

**That token is the whole authorization story.** There is no role for this endpoint, no grant to
check and no organization to trust: what a tool can see is what the caller's session can see,
decided by RLS in the ordinary way (D17, D34). `app.auth.require_caller` establishes *who* is
calling, authoritatively, before anything below it runs -- there is nothing it could usefully
decide about *what* that caller may see that Postgres does not decide better a moment later, and
a second copy of that decision here would be a weaker one. A stranger holding no genuine token
never reaches a tool at all; one who does still gets only what their own session can see, because
every tool is scoped by RLS, not by this file.

**What it will not do is answer for free.** A missing or malformed token is refused before a
provider is called, because a question with nobody behind it is a bill with nobody behind it.

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler

from app.ai.loop import answer
from app.ai.registry import answering_provider, unconfigured_reason
from app.auth import AuthError, require_caller
from app.core.config import load_assistant_settings


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_assistant_settings()
        if settings is None:
            self._reply(404, {"error": "not found"})
            return

        provider = answering_provider()
        if provider is None:
            # A deployment with no model. Said out loud rather than left as a silence, and in
            # the same words the settings screen uses (D31).
            self._reply(503, {"error": unconfigured_reason()})
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

        question = (body.get("question") or "").strip()
        organization_id = (body.get("organization_id") or "").strip()
        if not question or not organization_id:
            self._reply(400, {"error": "rejected"})
            return

        given = answer(
            settings,
            provider,
            question=question,
            token=caller.token,
            # Trusted only as far as RLS allows, which is the whole point: a caller naming a
            # business they are not in gets empty answers rather than somebody else's rows.
            organization_id=organization_id,
            # What the application knows and a model cannot. Sent by `apps/web`, which is
            # holding the organization already; asking Postgres for it here would be this
            # runtime reading business state outside a tool.
            context=(body.get("context") or "").strip(),
        )

        # **The run is not written here.** `apps/web` writes it, under the same session that
        # asked -- which is what makes `agent_runs.created_by` true and keeps this runtime
        # holding no write path at all. What goes back is everything that row needs.
        self._reply(
            200,
            {
                "outcome": given.outcome,
                "answer": given.text,
                "detail": given.detail,
                "answered_by": provider.name,
                "tools": [asdict(record) for record in given.tools],
                # Reported, and performed by nobody here. `apps/web` looks the name up in its
                # own whitelist and a person decides (D34).
                "action": asdict(given.action) if given.action else None,
            },
        )

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
