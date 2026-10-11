"""Running a granted tool: the one execution path for native connector capabilities and MCP tools.

**Who is asking is established here by the backend, never by the caller of a tool.** An
`ExecutionContext` can only be built by `for_assistant` or `for_automation`, which take the identity
the runtime already proved (a verified bearer token and the assistant it resolved from the
database; a rule id the scheduler read), and nothing in a tool's arguments, a model's output or a
request body ever reaches them. The organization is not trusted either: Postgres derives it from the
caller's membership or from the rule's own row.

**Authorization is a database decision, and it is recorded before anything leaves.** `authorize_*`
checks the grant, the target's liveness, the principal's state, any resource restriction and
whether a person must approve, and writes the execution row. Only an `allowed` decision reaches a
credential or a vendor.

**What this module will not do:** decide that a tool is safe because a server says so, run a native
capability that writes, return a credential, or keep a result. The outcome of a call is recorded as
facts (status, duration, size); the data goes to the one caller that asked, bounded.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.connectors import oauth_app_for, oauth_provider_for
from app.connectors.base import Capability, CapabilityInputError, UnsupportedCapability
from app.connectors.mcp import EndpointRefused, McpClient
from app.core import db
from app.core.config import IntegrationSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError
from app.providers.providers import MalformedAnswer, UpstreamRefused
from app.services.integrations import arguments as schema
from app.services.integrations import credentials

MAX_RESULT_BYTES = 30_000
MAX_TEXT_PER_ITEM = 8_000
MAX_CONTENT_ITEMS = 20
TOOL_PREFIX = "ext_"

_SEAL = object()

REFUSALS = {
    "not_granted": "This tool has not been granted to you.",
    "grant_revoked": "Access to this tool was withdrawn.",
    "connection_inactive": "The connection behind this tool is not active.",
    "server_disabled": "The server behind this tool is switched off.",
    "tool_removed": "The server no longer offers this tool.",
    "tool_not_enabled": "This tool has not been approved for use.",
    "resource_unavailable": "The resource this tool was limited to is no longer available.",
    "resource_not_granted": "This tool is limited to a different resource.",
    "resource_not_readable_by_assistant": "The assistant has not been allowed to read that resource.",
    "principal_inactive": "This agent or automation is not active.",
    "invalid_arguments": "The arguments were not usable.",
    "arguments_too_large": "The arguments were too large.",
    "too_many_pending": "Too many requests are waiting for approval.",
    "access_denied": "Access was denied.",
    "actor_not_permitted": "You do not have access to that kind of information.",
    "permission_unmapped": "This tool has no access rule yet, so it is not available.",
}


@dataclass(frozen=True)
class ExecutionContext:
    """The identity an execution runs as. Built only by the constructors below."""

    organization_id: str | None
    principal_kind: str
    principal_id: str
    correlation_id: str
    caller_token: str | None = field(default=None, repr=False)
    # The conversation a request is made in, if any: where an approved request's result is delivered.
    conversation_id: str | None = None
    _seal: object = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._seal is not _SEAL:
            raise TypeError("Build an ExecutionContext with for_assistant or for_automation.")

    @classmethod
    def for_assistant(
        cls,
        *,
        organization_id: str,
        assistant_id: str,
        caller_token: str,
        correlation_id: str | None = None,
        conversation_id: str | None = None,
    ) -> "ExecutionContext":
        return cls(
            organization_id, "assistant", assistant_id, correlation_id or uuid.uuid4().hex, caller_token, conversation_id, _SEAL
        )

    @classmethod
    def for_automation(cls, *, rule_id: str, correlation_id: str | None = None) -> "ExecutionContext":
        return cls(None, "automation", rule_id, correlation_id or uuid.uuid4().hex, None, None, _SEAL)


@dataclass(frozen=True)
class GrantedTool:
    grant_id: str
    target_kind: str
    connector_key: str
    description: str
    input_schema: dict
    requires_approval: bool
    resource_param: str | None
    capability_key: str | None = None
    mcp_tool_name: str | None = None
    # The one value a resource-limited grant allows for `resource_param`. Offered to the model as the
    # only choice and filled in when it leaves the argument out; the database checks it either way.
    resource_value: str | None = None

    @property
    def name(self) -> str:
        """The only handle a model is given. It maps back to a grant, never to a target."""
        return TOOL_PREFIX + self.grant_id.replace("-", "")


@dataclass(frozen=True)
class ToolOutcome:
    """What an execution request came to. `data` is present only for `succeeded`, and is bounded."""

    status: str  # succeeded | refused | approval_required | failed
    execution_id: str | None = None
    reason: str | None = None
    message: str = ""
    data: Any = None


# --- what a principal can see -----------------------------------------------------------------


def _capability(connector_key: str, key: str | None) -> Capability | None:
    if str(key or '').startswith('piece.'):
        from app.connectors.library import capabilities_for
        return next((c for c in capabilities_for(connector_key) if c.key==key),None)
    provider = oauth_provider_for(connector_key)
    if provider is None:
        return None
    return next((c for c in provider.capabilities if c.key == key), None)


def _build(row: dict) -> GrantedTool | None:
    if row.get("target_kind") == "native":
        capability = _capability(row.get("connector_key") or "", row.get("capability_key"))
        if capability is None or capability.writes:
            return None
        inputs = capability.input_schema()
        limited = row.get("resource_external_id") if row.get("resource_id") else None
        if limited and capability.resource_param in inputs["properties"]:
            inputs["properties"][capability.resource_param] = {
                **inputs["properties"][capability.resource_param],
                "enum": [limited],
            }
            inputs["required"] = [name for name in inputs["required"] if name != capability.resource_param]
        return GrantedTool(
            grant_id=row["grant_id"],
            target_kind="native",
            connector_key=row["connector_key"],
            description=capability.summary,
            input_schema=inputs,
            requires_approval=bool(row.get("requires_approval")),
            resource_param=capability.resource_param if row.get("resource_id") else None,
            capability_key=capability.key,
            resource_value=limited,
        )
    if row.get("target_kind") == "mcp" and row.get("mcp_tool_name"):
        raw = row.get("mcp_input_schema")
        return GrantedTool(
            grant_id=row["grant_id"],
            target_kind="mcp",
            connector_key=row.get("connector_key") or "mcp_server",
            description=schema.prose(str(row.get("mcp_description") or "")),
            input_schema=raw if isinstance(raw, dict) else {},
            requires_approval=True,
            resource_param=None,
            mcp_tool_name=row["mcp_tool_name"],
        )
    return None


def list_granted(settings: IntegrationSettings, ctx: ExecutionContext) -> list[GrantedTool]:
    """The live grants this principal holds. A revoked, disabled or stale grant is not in the list."""
    if ctx.principal_kind == "assistant":
        rows = caller_rest(
            settings.supabase_url,
            settings.supabase_publishable_key,
            ctx.caller_token or "",
            "POST",
            "rpc/granted_tools_for_assistant",
            json={"p_organization_id": ctx.organization_id, "p_assistant_id": ctx.principal_id},
        ).json()
    else:
        rows = db.granted_tools_for_automation(settings, rule_id=ctx.principal_id)
    return [tool for tool in (_build(row) for row in rows or []) if tool is not None]


# --- the request ------------------------------------------------------------------------------


def execute_granted_tool(settings: IntegrationSettings, ctx: ExecutionContext, *, grant_id: str, arguments: object) -> ToolOutcome:
    """Run one grant for the principal in `ctx`. Every refusal is a returned outcome, never a raise."""
    if not isinstance(arguments, dict):
        return ToolOutcome("refused", reason="invalid_arguments", message=REFUSALS["invalid_arguments"])

    try:
        granted = {tool.grant_id: tool for tool in list_granted(settings, ctx)}
    except (DomainError, RuntimeError, OSError):
        granted = {}
    tool = granted.get(grant_id)

    resource_value = None
    if tool is not None:
        if tool.resource_param and tool.resource_value and tool.resource_param not in arguments:
            arguments = {**arguments, tool.resource_param: tool.resource_value}
        found = schema.problems(tool.input_schema, arguments)
        if found:
            return ToolOutcome("failed", reason="invalid_input", message="; ".join(found))
        if tool.resource_param:
            raw = arguments.get(tool.resource_param)
            resource_value = raw if isinstance(raw, str) else None

    try:
        decision = _authorize(settings, ctx, grant_id, arguments, resource_value)
    except (DomainError, RuntimeError):
        return ToolOutcome("refused", reason="access_denied", message=REFUSALS["access_denied"])

    execution_id = decision.get("execution_id")
    if decision.get("decision") == "refused":
        reason = str(decision.get("reason") or "access_denied")
        return ToolOutcome("refused", execution_id, reason, REFUSALS.get(reason, REFUSALS["access_denied"]))
    if decision.get("decision") == "approval_required":
        return ToolOutcome(
            "approval_required",
            execution_id,
            message="A person must approve this before it runs. It is waiting in the organization's approval list.",
        )

    if tool is None:
        # Authorized, yet absent from this principal's live list a moment ago: nothing to validate
        # the arguments against, so nothing is sent.
        return _finish(settings, execution_id, False, ToolOutcome("failed", execution_id, "invalid_input", "That tool changed; try again."))
    return _run(settings, execution_id, decision, arguments)


def _authorize(settings: IntegrationSettings, ctx: ExecutionContext, grant_id: str, arguments: dict, resource_value: str | None) -> dict:
    if ctx.principal_kind == "assistant":
        answer = caller_rest(
            settings.supabase_url,
            settings.supabase_publishable_key,
            ctx.caller_token or "",
            "POST",
            "rpc/authorize_assistant_tool_call",
            json={
                "p_organization_id": ctx.organization_id,
                "p_assistant_id": ctx.principal_id,
                "p_grant_id": grant_id,
                "p_arguments": arguments,
                "p_resource_value": resource_value,
                "p_correlation": ctx.correlation_id,
                "p_conversation_id": ctx.conversation_id,
            },
        ).json()
    else:
        answer = db.authorize_automation_tool_call(
            settings,
            rule_id=ctx.principal_id,
            grant_id=grant_id,
            arguments=arguments,
            resource_value=resource_value,
            correlation=ctx.correlation_id,
        )
    if not isinstance(answer, dict):
        raise RuntimeError("authorization gave no decision")
    return answer


def run_approved(settings: IntegrationSettings, decision: dict) -> ToolOutcome:
    """Execute a request a person approved. The arguments are the ones stored with the request."""
    arguments = decision.get("arguments")
    return _run(settings, str(decision["execution_id"]), decision, arguments if isinstance(arguments, dict) else {}, deliver=True)


# --- the run ----------------------------------------------------------------------------------


def _run(settings: IntegrationSettings, execution_id: str, target: dict, arguments: dict, *, deliver: bool = False) -> ToolOutcome:
    secrets: list[str] = []
    try:
        if target.get("target_kind") == "mcp":
            data = _run_mcp(settings, target, arguments, secrets)
            if data.get("is_error"):
                return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "tool_error", "The tool reported an error.", _redact(data, secrets)))
        else:
            data = _run_native(settings, target, arguments, secrets, execution_id=execution_id)
    except CapabilityInputError as failure:
        return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "invalid_input", str(failure)))
    except UnsupportedCapability:
        return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "unsupported", "That operation is not available."))
    except _Disabled as failure:
        return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "unsupported", str(failure)))
    except _CredentialUnavailable as failure:
        return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "credential_unavailable", str(failure)))
    except (EndpointRefused, UpstreamRefused, MalformedAnswer) as failure:
        reached = "could not be reached" in str(failure)
        return _finish(
            settings,
            execution_id,
            deliver,
            ToolOutcome("failed", execution_id, "unreachable" if reached else "provider_refused", _words(failure, secrets)),
        )
    except Exception:  # noqa: BLE001 - nothing of the failure may reach a model or a log line
        return _finish(settings, execution_id, deliver, ToolOutcome("failed", execution_id, "internal", "The operation failed."))

    return _finish(settings, execution_id, deliver, ToolOutcome("succeeded", execution_id, data=_bounded(_redact(data, secrets))))


class _CredentialUnavailable(RuntimeError):
    pass


class _Disabled(RuntimeError):
    pass


def _run_native(settings: IntegrationSettings, target: dict, arguments: dict, secrets: list[str], *, execution_id: str | None = None) -> dict:
    connector_key = str(target.get("connector_key") or "")
    capability = _capability(connector_key, target.get("capability_key"))
    if capability is None or capability.writes:
        raise UnsupportedCapability("not offered")
    found = schema.problems(capability.input_schema(), arguments)
    if found:
        raise CapabilityInputError("; ".join(found))

    if capability.key.startswith('piece.'):
        from app.connectors.library import call_worker
        from app.services.integrations.library_operations import prepare
        prepare(settings,str(target['connection_id']),connector_key)
        job = db._integration_rpc(settings,'queue_granted_integration_library_read',{
            'p_execution_id':execution_id,'p_arguments':arguments})
        return call_worker({'job_id':job})['data']

    provider, app = oauth_provider_for(connector_key), oauth_app_for(connector_key)
    if provider is None or app is None:
        raise _CredentialUnavailable("This deployment is not set up for that app.")
    connection_id = str(target["connection_id"])
    held = credentials.held(settings, connection_id)
    if held is None:
        raise _CredentialUnavailable("That connection has no credential stored. Reconnect it.")
    secrets.extend(str(held[key]) for key in ("access_token", "refresh_token") if held.get(key))

    try:
        access_token, _scopes = credentials.usable_token(settings, provider, app, connection_id, held)
    except UpstreamRefused as failure:
        # The sign-in itself is dead, which is a fact about the whole connection.
        db.record_integration_health(settings, connection_id=connection_id, ok=False, error=str(failure))
        raise
    secrets.append(access_token)
    return provider.invoke(capability.key, access_token, arguments)


def _run_mcp(settings: IntegrationSettings, target: dict, arguments: dict, secrets: list[str]) -> dict:
    if not settings.mcp_custom_endpoints:
        raise _Disabled("Custom MCP servers are not enabled on this deployment.")
    held = credentials.held(settings, str(target["connection_id"])) or {}
    bearer = held.get("bearer") if isinstance(held.get("bearer"), str) else None
    if bearer:
        secrets.append(bearer)

    client = McpClient(str(target["mcp_endpoint"]), bearer=bearer)
    try:
        client.initialize()
        result = client.call_tool(str(target["mcp_tool_name"]), arguments)
    finally:
        client.close()
    return {
        "source": "mcp_server",
        "is_error": result["is_error"],
        "content": _content(result["content"]),
        "structured": result["structured"] if _small(result["structured"]) else None,
    }


# --- results ----------------------------------------------------------------------------------


def _content(items: list) -> list[dict]:
    kept: list[dict] = []
    for item in items[:MAX_CONTENT_ITEMS]:
        if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
            kept.append({"type": "text", "text": item["text"][:MAX_TEXT_PER_ITEM]})
        elif isinstance(item, dict):
            kept.append({"type": str(item.get("type") or "unknown")[:40], "omitted": True})
    return kept


def _small(value: object) -> bool:
    try:
        return len(json.dumps(value)) <= MAX_RESULT_BYTES
    except (TypeError, ValueError):
        return False


def _redact(data: Any, secrets: list[str]) -> Any:
    """Remove every credential this call used from anything about to be returned."""
    text = json.dumps(data, default=str)
    for secret in {s for s in secrets if len(s) >= 6}:
        text = text.replace(json.dumps(secret)[1:-1], "[redacted]")
    return json.loads(text)


def _words(failure: Exception, secrets: list[str]) -> str:
    message = str(failure)
    for secret in {s for s in secrets if len(s) >= 6}:
        message = message.replace(secret, "[redacted]")
    return message[:300]


def _bounded(data: Any) -> Any:
    if _small(data):
        return data
    return {"truncated": True, "note": "The result was too large to return; narrow the request."}


def _finish(settings: IntegrationSettings, execution_id: str | None, deliver: bool, outcome: ToolOutcome) -> ToolOutcome:
    """Write down how it ended. A failure to record never changes what the caller is told."""
    if execution_id:
        try:
            size = len(json.dumps(outcome.data, default=str)) if outcome.status == "succeeded" else None
            db.complete_integration_execution(
                settings,
                execution_id=execution_id,
                succeeded=outcome.status == "succeeded",
                error_class=None if outcome.status == "succeeded" else outcome.reason,
                result_bytes=size,
                # Handed over only for a request a person approved, and held by the database only if it
                # was made inside a conversation that can take it.
                result=outcome.data if deliver and outcome.status == "succeeded" else None,
            )
        except RuntimeError:
            pass
    return outcome
