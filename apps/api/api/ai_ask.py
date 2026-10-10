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
provider is called, because a question with nobody behind it is a bill with nobody behind it. So
is a business that does not hold the Agent: `assistant.ask` is a role's permission, and whether the
*business* has the module is a separate, commercial question asked here, at the point of spend
(`app.ai.entitlement`). What a question consumed is written down after it is answered
(`app.ai.metering`).

Vercel's Python runtime routes a file under `api/` to a path (D24). One file, one route.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler

from app.ai import AttachedText, PriorTurn
from app.ai.entitlement import ASSISTANT_MODULE, EntitlementUnavailable, holds_module
from app.ai.loop import answer
from app.ai.configuration import resolve_configuration
from app.ai.metering import meter
from app.ai.registry import unconfigured_reason
from app.ai.runtime import OPERATOR_ASSISTANT, resolve_provider
from app.auth import AuthError, require_caller
from app.ai.external import external_tools_for
from app.core.config import load_assistant_settings, load_integration_settings, load_provider_operations_settings
from app.services.integrations.executor import ExecutionContext


def _prior_turns(raw: object) -> tuple[PriorTurn, ...]:
    """Well-formed `{question, answer}` pairs, and nothing else a body might carry."""
    if not isinstance(raw, list):
        return ()
    return tuple(
        PriorTurn(question=item["question"], answer=item["answer"])
        for item in raw
        if isinstance(item, dict)
        and isinstance(item.get("question"), str)
        and isinstance(item.get("answer"), str)
        and item["question"].strip()
        and item["answer"].strip()
    )


def _attachments(raw: object) -> tuple[AttachedText, ...]:
    """Well-formed `{name, mimeType, text}` files; anything else in a body is dropped."""
    if not isinstance(raw, list):
        return ()
    return tuple(
        AttachedText(
            name=item["name"],
            mime_type=item["mimeType"],
            text=item["text"],
            truncated=item.get("truncated") is True,
        )
        for item in raw
        if isinstance(item, dict)
        and isinstance(item.get("name"), str)
        and isinstance(item.get("mimeType"), str)
        and isinstance(item.get("text"), str)
    )


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_assistant_settings()
        if settings is None:
            self._reply(404, {"error": "not found"})
            return

        # **The caller is proved before anything reaches Vault.** A GOLD-owned Provider Account
        # credential must never be read on the strength of a request nobody has authenticated --
        # resolving the runtime provider is itself a read (`read_provider_account_credential`),
        # so it waits until here, exactly where every other read in this handler already waits.
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

        # **Entitlement before anything is spent, and before Vault is read.** Asked as the caller,
        # so a business they are not in answers the same *no* as one that has not bought the
        # Agent. A database that cannot say is a different word from *no*.
        try:
            entitled = holds_module(
                settings, token=caller.token, organization_id=organization_id, module_key=ASSISTANT_MODULE
            )
        except EntitlementUnavailable:
            self._reply(503, {"error": "could not check whether this business has the Agent"})
            return
        if not entitled:
            self._reply(
                403,
                {"error": "this business does not have the Agent", "code": "not_entitled"},
            )
            return

        try:
            preview = body.get("preview")
            if preview is not None and not isinstance(preview, dict):
                raise ValueError("Invalid preview")
            instructions, allowed_tools, allowed_actions, agent_configuration = resolve_configuration(
                settings, token=caller.token, organization_id=organization_id, preview=preview,
                conversation_id=body.get("conversation_id") or None,
            )
        except Exception:
            self._reply(403, {"error": "Agent configuration is unavailable or access was denied"})
            return

        operations = load_provider_operations_settings()
        try:
            # An explicit assignment is authoritative and never fails over; a capability with
            # none keeps answering exactly as it always has (app.ai.runtime).
            provider = resolve_provider(operations, capability=OPERATOR_ASSISTANT)
        except RuntimeError as failure:
            self._reply(503, {"error": str(failure)})
            return
        if provider is None:
            # A deployment with no model. Said out loud rather than left as a silence, and in
            # the same words the settings screen uses (D31).
            self._reply(503, {"error": unconfigured_reason()})
            return

        external = None
        integrations = load_integration_settings()
        assistant_id = agent_configuration.get("id") if isinstance(agent_configuration, dict) and preview is None else None
        if integrations is not None and assistant_id:
            try:
                # The identity is what was just resolved for this signed-in caller, never anything the
                # body or a model said; the database re-proves membership on every call.
                external = external_tools_for(
                    integrations,
                    ExecutionContext.for_assistant(
                        organization_id=organization_id, assistant_id=str(assistant_id), caller_token=caller.token
                    ),
                )
            except Exception:  # noqa: BLE001 - granted tools are an addition; without them the agent still answers
                external = None

        given = answer(
            settings,
            provider,
            question=question,
            token=caller.token,
            # Trusted only as far as RLS allows, which is the whole point: a caller naming a
            # business they are not in gets empty answers rather than somebody else's rows.
            organization_id=organization_id,
            instructions=instructions,
            tools=allowed_tools,
            actions=allowed_actions,
            # What the application knows and a model cannot. Sent by `apps/web`, which is
            # holding the organization already; asking Postgres for it here would be this
            # runtime reading business state outside a tool.
            context=(body.get("context") or "").strip(),
            # Earlier turns of the one conversation `apps/web` read for this caller. Text only;
            # the loop bounds it again rather than trusting how carefully it was built.
            prior_turns=_prior_turns(body.get("history")),
            attachments=_attachments(body.get("attachments")),
            external=external,
        )

        usage = meter(
            operations,
            organization_id=organization_id,
            capability=OPERATOR_ASSISTANT,
            provider_key=provider.provider_key,
            given=given,
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
                # Whether what this answer consumed was written down: `recorded`, `none_reported`
                # or `failed`. Carried back rather than swallowed, so a failed meter is visible.
                "metering": usage,
                "agent_version_id": agent_configuration.get("versionId"),
                "agent_deployment_id": agent_configuration.get("deploymentId"),
            },
        )

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
