"""Drafting a business's configuration from its own description.

**The same runtime as the operator's questions, for the same reasons.** Which provider answers,
with which account and model, is `platform_ai_runtime_assignments`' decision for the
`configuration_drafting` capability (`app.ai.runtime`); this runtime holds the credential, and
`apps/web` holds none. What it consumes is metered through the same writer, and whether the
business holds guided setup is asked before anything is spent.

**One shot, not a conversation.** The model is given a single way to answer -- an action,
`submit_configuration`, whose input is the schema `apps/web` built from the domain's own lists --
and the loop stops the moment it is called. That is the loop's existing "propose, never perform"
shape: nothing here writes a configuration, and what comes back is a proposal a person reads, edits
and applies under their own session (D32). `apps/web` re-narrows it into the domain's own types
and the domain layer remains the guarantee; a schema is a request for a shape, not validation.

**The platform's rules for the model are here; the vocabulary is the caller's.** The prompt is
`app.ai.prompts.DRAFTING`. The schema is supplied, because it is built from capability, field-kind,
trigger and module lists that live in TypeScript -- restating them here would be a copy that is
right on the day it is written. It is bounded, and it is only ever a tool's input schema.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from app.ai import Tool
from app.ai.entitlement import DRAFTING_MODULE, EntitlementUnavailable, holds_module
from app.ai.loop import answer
from app.ai.metering import meter
from app.ai.registry import unconfigured_reason
from app.ai.runtime import CONFIGURATION_DRAFTING, resolve_provider
from app.auth import AuthError, require_caller
from app.core.config import load_assistant_settings, load_provider_operations_settings

# A description is capped at 8,000 characters by `apps/web`; the request also carries the shape being
# revised, so this is generous without being unbounded. A request that grew without limit is a bill
# that grew without limit.
MAX_REQUEST_CHARS = 120_000
MAX_SCHEMA_CHARS = 60_000

SUBMIT = "submit_configuration"


def _submit_tool(schema: dict) -> Tool:
    return Tool(
        name=SUBMIT,
        description=(
            "Submit the proposed configuration. This proposes it: the person reads it, changes "
            "what they like and applies it themselves. Call it exactly once."
        ),
        schema=schema,
        # Deliberately empty, as for every action: there is no function to run (`app.ai.actions`).
        function="",
    )


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_assistant_settings()
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
        if length > MAX_REQUEST_CHARS * 4:
            self._reply(413, {"error": "rejected"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._reply(400, {"error": "rejected"})
            return

        question = (body.get("question") or "").strip()
        organization_id = (body.get("organization_id") or "").strip()
        schema = body.get("schema")
        if (
            not question
            or not organization_id
            or len(question) > MAX_REQUEST_CHARS
            or not isinstance(schema, dict)
            or schema.get("type") != "object"
            or len(json.dumps(schema)) > MAX_SCHEMA_CHARS
        ):
            self._reply(400, {"error": "rejected"})
            return

        try:
            entitled = holds_module(
                settings, token=caller.token, organization_id=organization_id, module_key=DRAFTING_MODULE
            )
        except EntitlementUnavailable:
            self._reply(503, {"error": "could not check whether this business has guided setup"})
            return
        if not entitled:
            self._reply(
                403, {"error": "this business does not have guided setup", "code": "not_entitled"}
            )
            return

        operations = load_provider_operations_settings()
        try:
            provider = resolve_provider(operations, capability=CONFIGURATION_DRAFTING)
        except RuntimeError as failure:
            self._reply(503, {"error": str(failure)})
            return
        if provider is None:
            self._reply(503, {"error": unconfigured_reason()})
            return

        given = answer(
            settings,
            provider,
            question=question,
            token=caller.token,
            organization_id=organization_id,
            tools=(),
            actions=(_submit_tool(schema),),
            audience="drafting",
        )
        usage = meter(
            operations,
            organization_id=organization_id,
            capability=CONFIGURATION_DRAFTING,
            provider_key=provider.provider_key,
            given=given,
        )

        # `declined` is the model answering in words instead of submitting: a description it would
        # not turn into a setup, which the person can fix by writing a different one. Anything that
        # broke is `failed`, and the two are different sentences on a screen.
        submitted = given.action if given.action and given.action.name == SUBMIT else None
        outcome = "drafted" if submitted else ("failed" if given.outcome == "failed" else "declined")
        self._reply(
            200,
            {
                "outcome": outcome,
                "configuration": submitted.arguments if submitted else None,
                "detail": given.detail or given.text,
                "answered_by": provider.name,
                "metering": usage,
            },
        )

    def _reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
