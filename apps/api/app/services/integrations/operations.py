"""Running one operation on a tenant's OAuth connection.

**Authorization is proved before any credential is read or written, and it is RLS that proves
it.** The caller's own token asks `can_manage_integrations` (the caller's rights, not this
runtime's) and selects the connection row (a business sees its own and nobody else's, so an empty
answer means *not yours, or no such connection* -- I18's ambiguous refusal). Only then does this
mint the one machine token that may touch the credential.

**Nothing here decides what a vendor means.** `app.connectors` owns the handshake and the
two reads; this module sequences them, records what happened, and returns only what a person may
see: never a token, never a refresh token, never the client secret.
"""

from __future__ import annotations

import json
import secrets

import httpx

from app.auth import CallerContext
from app.core import db
from app.core.config import IntegrationSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError, NotFoundError, ValidationError
from app.services.integrations import arguments as schema
from app.services.integrations import credentials, executor
from app.services.integrations.state import StateInvalid, sign_state, verify_state
from app.connectors import Readiness, oauth_app_for, oauth_provider_for, readiness_of, registered_connector_keys
from app.connectors.base import CapabilityInputError, OAuthApp, OAuthProvider, Tokens, UnsupportedCapability
from app.connectors.mcp import EndpointRefused, McpClient, check_endpoint
from app.providers.providers import UpstreamRefused


class ProviderRefusedError(DomainError):
    """The vendor refused, or could not be reached."""

    status = 502
    code = "provider_refused"


def _rest(settings: IntegrationSettings, caller: CallerContext, method: str, path: str, **kwargs) -> httpx.Response:
    """A call to PostgREST under the caller's own token -- RLS answers, not this runtime."""
    return caller_rest(settings.supabase_url, settings.supabase_publishable_key, caller.token, method, path, **kwargs)


def _require_manage(settings: IntegrationSettings, caller: CallerContext, organization_id: str) -> None:
    answer = _rest(
        settings, caller, "POST", "rpc/can_manage_integrations", json={"p_organization_id": organization_id}
    ).json()
    if answer is not True:
        raise NotFoundError("No such business.")


def _connection(settings: IntegrationSettings, caller: CallerContext, connection_id: str) -> dict:
    rows = _rest(
        settings,
        caller,
        "GET",
        "integration_connections",
        params={"id": f"eq.{connection_id}", "select": "id,organization_id,connector_key,status"},
    ).json()
    if not rows:
        raise NotFoundError("No such connection.")
    _require_manage(settings, caller, rows[0]["organization_id"])
    return rows[0]


def _client(connector_key: str) -> tuple[OAuthProvider, OAuthApp]:
    provider = oauth_provider_for(connector_key)
    if provider is None:
        raise ValidationError("That app cannot be connected with a sign-in.")
    app = oauth_app_for(connector_key)
    if app is None:
        raise ValidationError("This deployment is not set up to connect that app yet.")
    return provider, app


# Whatever else a vendor put on its redirect that the browser relayed. Strings only, a few of them, and
# short: a provider reads the few it knows and every other is ignored, and none is trusted -- a
# provider that depends on one proves it itself (GitHub asks which installations the *person* can reach).
def _relayed(arguments: dict) -> dict[str, str]:
    given = arguments.get("extra")
    if not isinstance(given, dict):
        return {}
    return {str(k)[:40]: str(v)[:200] for k, v in list(given.items())[:10] if isinstance(v, (str, int))}


def begin(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    organization_id = str(arguments.get("organization_id") or "")
    connector_key = str(arguments.get("connector_key") or "")
    connection_id = str(arguments.get("connection_id") or "") or None
    if not organization_id or not connector_key:
        raise ValidationError("A business and an app are both required.")

    _require_manage(settings, caller, organization_id)

    # The caller's own rights decide whether this connector exists for them and is connectable at all.
    catalogue = _rest(
        settings,
        caller,
        "GET",
        "platform_connectors",
        params={"key": f"eq.{connector_key}", "select": "status"},
    ).json()
    if not catalogue or catalogue[0]["status"] == "planned":
        raise NotFoundError("No such app.")

    if connection_id is not None:
        existing = _connection(settings, caller, connection_id)
        if existing["organization_id"] != organization_id or existing["connector_key"] != connector_key:
            raise NotFoundError("No such connection.")

    provider, app = _client(connector_key)
    nonce = secrets.token_urlsafe(16)
    state = sign_state(
        settings.state_secret,
        {"org": organization_id, "sub": caller.user_id, "key": connector_key, "conn": connection_id, "nonce": nonce},
    )
    return {"url": provider.authorize_url(app, state=state, redirect_uri=settings.redirect_uri), "nonce": nonce}


def complete(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    code = str(arguments.get("code") or "")
    state = str(arguments.get("state") or "")
    nonce = str(arguments.get("nonce") or "")

    try:
        claims = verify_state(settings.state_secret, state)
    except StateInvalid as failure:
        raise ValidationError("That sign-in expired or was not started here. Try connecting again.") from failure

    # The state is authentic; it must also be *this* browser's, and *this* person's.
    if not nonce or not secrets.compare_digest(nonce, str(claims.get("nonce", ""))) or claims.get("sub") != caller.user_id:
        raise ValidationError("That sign-in expired or was not started here. Try connecting again.")
    if not code:
        raise ValidationError("The provider returned no authorization code.")

    organization_id, connector_key, connection_id = claims["org"], claims["key"], claims.get("conn")
    _require_manage(settings, caller, organization_id)
    provider, app = _client(connector_key)

    try:
        tokens = provider.exchange(app, code=code, redirect_uri=settings.redirect_uri, extra=_relayed(arguments))
        account = provider.account(tokens.access_token)
    except UpstreamRefused as failure:
        raise ProviderRefusedError(str(failure)) from failure

    if tokens.refresh_token is None and connection_id is None:
        # Without one the connection would die within the hour and could not be rotated.
        raise ProviderRefusedError("The provider did not allow this connection to stay signed in. Try again and accept every permission.")

    if connection_id is None:
        # The ordinary door, under the caller's own rights: the insert policy refuses a planned or private connector.
        created = _rest(
            settings,
            caller,
            "POST",
            "rpc/record_integration_connection",
            json={"p_organization_id": organization_id, "p_connector_key": connector_key, "p_account_label": account.label},
        )
        connection_id = created.json()
    else:
        _connection(settings, caller, connection_id)

    if tokens.refresh_token is None:
        # A reconnect that returned no new refresh token keeps the one already stored.
        held = _held_credential(settings, connection_id)
        if held and held.get("refresh_token"):
            tokens = Tokens(tokens.access_token, held["refresh_token"], tokens.expires_at, tokens.scopes)

    db.store_integration_credential(settings, connection_id=connection_id, secret=credentials.pack(tokens))
    db.record_integration_health(
        settings, connection_id=connection_id, ok=True, account_label=account.label, scopes=tokens.scopes
    )
    _discover(settings, provider, connection_id, tokens.access_token)
    return {"organization_id": organization_id, "connection_id": connection_id}


def _held_credential(settings: IntegrationSettings, connection_id: str) -> dict | None:
    return credentials.held(settings, connection_id)


def _discover(settings: IntegrationSettings, provider: OAuthProvider, connection_id: str, access_token: str) -> int:
    """What this authorization can reach. Failing to list is not failing to connect."""
    try:
        resources = provider.resources(access_token)
    except UpstreamRefused:
        return 0
    db.replace_integration_resources(settings, connection_id=connection_id, resources=resources)
    return len(resources)


def _usable_token(settings: IntegrationSettings, provider: OAuthProvider, app: OAuthApp, connection_id: str, held: dict):
    return credentials.usable_token(settings, provider, app, connection_id, held)


def sync(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Check a connection: rotate its token if it is near expiry, ask who the account is, list what it reaches."""
    connection = _connection(settings, caller, str(arguments.get("connection_id") or ""))
    connection_id = connection["id"]
    provider, app = _client(connection["connector_key"])

    held = _held_credential(settings, connection_id)
    if held is None:
        raise ValidationError("That connection has no credential stored. Reconnect it.")

    try:
        access_token, scopes = _usable_token(settings, provider, app, connection_id, held)
        account = provider.account(access_token)
    except UpstreamRefused as failure:
        db.record_integration_health(settings, connection_id=connection_id, ok=False, error=str(failure))
        raise ProviderRefusedError(str(failure)) from failure

    count = _discover(settings, provider, connection_id, access_token)
    db.record_integration_health(
        settings, connection_id=connection_id, ok=True, account_label=account.label, scopes=scopes
    )
    return {"ok": True, "resources": count}


def capabilities(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """What each connector declares it can do. A fact about the deployed code, so it reads no business."""
    listed = []
    for key in _keys_asked(arguments):
        provider = oauth_provider_for(key)
        from app.connectors.library import capabilities_for
        available = (*(provider.capabilities if provider else ()), *capabilities_for(key))
        if available:
            listed.append(
                {
                    "connector_key": key,
                    "capabilities": [
                        {
                            "key": c.key,
                            "summary": c.summary,
                            "workspace": c.workspace,
                            "writes": c.writes,
                            "inputs": c.input_schema(),
                            "resource_type": c.resource_type,
                        }
                        for c in available
                    ],
                }
            )
    return {"connectors": listed}


def invoke(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Run one declared capability on a connection the caller manages.

    Authorization is the same proof `sync` makes. Only capabilities the connector declares can run, and
    one that writes is refused here until a grant model exists to authorize it. It never records a
    connection as healthy: a call that worked proves one operation, not the connection.
    """
    if str(arguments.get('capability') or '').startswith('piece.'):
        from app.services.integrations.library_operations import invoke as invoke_library
        return invoke_library(settings,caller,arguments)
    connection = _connection(settings, caller, str(arguments.get("connection_id") or ""))
    connection_id = connection["id"]
    if connection["status"] != "active":
        raise ValidationError("That connection is not active. Reconnect it.")
    provider, app = _client(connection["connector_key"])

    key = str(arguments.get("capability") or "")
    declared = next((c for c in provider.capabilities if c.key == key), None)
    if declared is None:
        raise ValidationError("That app does not offer that operation.")
    if declared.writes:
        raise ValidationError("Operations that change data in the app are not available yet.")
    params = arguments.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ValidationError("params must be an object.")
    found = schema.problems(declared.input_schema(), params)
    if found:
        raise ValidationError("; ".join(found))

    held = _held_credential(settings, connection_id)
    if held is None:
        raise ValidationError("That connection has no credential stored. Reconnect it.")

    try:
        access_token, scopes = _usable_token(settings, provider, app, connection_id, held)
    except UpstreamRefused as failure:
        # The sign-in itself is dead, which is a fact about the whole connection.
        db.record_integration_health(settings, connection_id=connection_id, ok=False, error=str(failure))
        raise ProviderRefusedError(str(failure)) from failure

    try:
        data = provider.invoke(key, access_token, params)
    except (UnsupportedCapability, CapabilityInputError) as failure:
        raise ValidationError(str(failure)) from failure
    except UpstreamRefused as failure:
        # One refused operation (a scope never granted, say) does not make the connection unhealthy;
        # only `sync` re-verifies the connection as a whole.
        raise ProviderRefusedError(str(failure)) from failure

    return {"capability": key, "data": data}


# --- MCP servers ------------------------------------------------------------------------------

_MAX_SERVERS_PER_ORGANIZATION = 20
_MAX_BEARER = 4000


def _require_mcp_enabled(settings: IntegrationSettings) -> None:
    if not settings.mcp_custom_endpoints:
        raise ValidationError("Custom MCP servers are not enabled on this deployment.")


def _words(failure: Exception, bearer: str | None) -> str:
    message = str(failure)
    if bearer:
        message = message.replace(bearer, "[redacted]")
    return message[:300]


def _discover_server(settings: IntegrationSettings, *, connection_id: str, server_id: str, endpoint: str, bearer: str | None) -> dict:
    """Initialize, list the tools, and record what was found. Finding tools enables nothing."""
    client: McpClient | None = None
    try:
        client = McpClient(endpoint, bearer=bearer)
        client.initialize()
        tools = client.list_tools()
        protocol, server_name = client.protocol_version, str(client.server_info.get("name") or "")
    except (EndpointRefused, UpstreamRefused) as failure:
        error = _words(failure, bearer)
        db.record_mcp_discovery(settings, server_id=server_id, ok=False, error=error)
        db.record_integration_health(settings, connection_id=connection_id, ok=False, error=error)
        return {"ok": False, "error": error}
    finally:
        if client is not None:
            client.close()

    count = db.record_mcp_discovery(
        settings,
        server_id=server_id,
        ok=True,
        protocol_version=protocol,
        server_name=server_name,
        tools=[
            {"name": t.name, "description": t.description, "input_schema": t.input_schema, "read_only_hint": t.read_only_hint}
            for t in tools
        ],
    )
    db.record_integration_health(settings, connection_id=connection_id, ok=True)
    return {"ok": True, "tools": count, "protocol_version": protocol}


def mcp_connect(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Register an MCP server for a business, store its credential, and discover its tools."""
    _require_mcp_enabled(settings)
    organization_id = str(arguments["organization_id"])
    name = str(arguments.get("name") or "").strip()
    bearer = arguments.get("bearer")
    if not 1 <= len(name) <= 120:
        raise ValidationError("A server needs a name of up to 120 characters.")
    if bearer is not None and (
        not isinstance(bearer, str) or not bearer.strip() or len(bearer) > _MAX_BEARER or any(ord(ch) < 33 for ch in bearer.strip())
    ):
        raise ValidationError("That access token is not usable.")
    bearer = bearer.strip() if isinstance(bearer, str) else None
    try:
        endpoint = check_endpoint(str(arguments.get("endpoint") or "")).url
    except EndpointRefused as refused:
        raise ValidationError(str(refused)) from refused

    _require_manage(settings, caller, organization_id)
    existing = _rest(
        settings, caller, "GET", "integration_mcp_servers", params={"organization_id": f"eq.{organization_id}", "select": "id"}
    ).json()
    if len(existing) >= _MAX_SERVERS_PER_ORGANIZATION:
        raise ValidationError("This business has reached its limit of MCP servers. Remove one first.")

    connection_id = _rest(
        settings,
        caller,
        "POST",
        "rpc/record_integration_connection",
        json={"p_organization_id": organization_id, "p_connector_key": "mcp_server", "p_account_label": name},
    ).json()
    if bearer:
        db.store_integration_credential(settings, connection_id=connection_id, secret=json.dumps({"bearer": bearer}))
    server_id = db.upsert_mcp_server(settings, organization_id=organization_id, connection_id=connection_id, name=name, endpoint=endpoint)

    result = _discover_server(settings, connection_id=connection_id, server_id=server_id, endpoint=endpoint, bearer=bearer)
    return {"connection_id": connection_id, "server_id": server_id, **result}


def mcp_discover(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Test a server and refresh its tool list. A changed tool returns to unreviewed and disabled."""
    _require_mcp_enabled(settings)
    connection = _connection(settings, caller, str(arguments["connection_id"]))
    if connection["connector_key"] != "mcp_server":
        raise NotFoundError("No such server.")
    servers = _rest(
        settings,
        caller,
        "GET",
        "integration_mcp_servers",
        params={"connection_id": f"eq.{connection['id']}", "select": "id,endpoint"},
    ).json()
    if not servers:
        raise NotFoundError("No such server.")
    held = credentials.held(settings, connection["id"]) or {}
    bearer = held.get("bearer") if isinstance(held.get("bearer"), str) else None
    return _discover_server(
        settings, connection_id=connection["id"], server_id=servers[0]["id"], endpoint=servers[0]["endpoint"], bearer=bearer
    )


def approve_execution(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Decide a request waiting for approval, and run it if it was approved.

    The database decides whether this caller may decide it and whether the grant, the target and the
    principal are all still live; what runs is the request as stored, not anything sent here.
    """
    approve = arguments.get("approve") is True
    try:
        decision = _rest(
            settings,
            caller,
            "POST",
            "rpc/decide_integration_execution",
            json={"p_execution_id": str(arguments["execution_id"]), "p_approve": approve},
        ).json()
    except DomainError as refused:
        raise NotFoundError("That request could not be decided. It may have been decided already or have expired.") from refused

    if decision.get("decision") != "approved":
        return {"decision": decision.get("decision"), "reason": decision.get("reason")}
    outcome = executor.run_approved(settings, decision)
    return {"decision": "approved", "status": outcome.status, "reason": outcome.reason, "execution_id": outcome.execution_id}


def disconnect(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Revoke upstream where the vendor allows it, delete the credential, then retire the connection."""
    connection = _connection(settings, caller, str(arguments.get("connection_id") or ""))
    connection_id = connection["id"]

    held = _held_credential(settings, connection_id)
    provider = oauth_provider_for(connection["connector_key"])
    app = oauth_app_for(connection["connector_key"])
    if held and provider and app:
        try:
            provider.revoke(app, token=held.get("refresh_token") or held["access_token"])
        except UpstreamRefused:
            pass  # Deleting GOLD's copy is what this person asked for; the vendor being down is not a reason to keep it.

    db.clear_integration_credential(settings, connection_id=connection_id)
    _rest(
        settings,
        caller,
        "POST",
        "rpc/disconnect_integration",
        json={"p_organization_id": connection["organization_id"], "p_connection_id": connection_id},
    )
    return {"ok": True}


def _keys_asked(arguments: dict) -> list[str]:
    asked = arguments.get("connector_keys")
    if isinstance(asked, list) and asked:
        return [str(key) for key in asked][:200]
    return registered_connector_keys()


def readiness(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Whether this deployment can connect each app. For any signed-in caller: a yes or a coarse
    reason, never the names of the inputs and never a value. Authority over *who* may connect is
    still `begin`'s, so this reads nothing of any business."""
    return {"connectors": [_public_readiness(readiness_of(key)) for key in _keys_asked(arguments)]}


def readiness_detail(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """The same answer plus what is missing and where providers must send people back -- platform
    staff only. Staff is proved the way the web proves it: a staff-only database function answers
    under the caller's own token, so this runtime decides nothing about who staff is."""
    try:
        _rest(settings, caller, "POST", "rpc/platform_connector_usage", json={})
    except DomainError as refused:
        raise NotFoundError("No such operation.") from refused
    return {
        "redirect_uri": settings.redirect_uri,
        "connectors": [
            {**_public_readiness(found), "required_configuration": list(found.required_configuration)}
            for found in (readiness_of(key) for key in _keys_asked(arguments))
        ],
    }


def _public_readiness(found: Readiness) -> dict:
    return {
        "connector_key": found.connector_key,
        "implemented": found.implemented,
        "configured": found.configured,
        "reason": found.reason,
    }


OPERATIONS = {
    "begin": begin,
    "complete": complete,
    "sync": sync,
    "disconnect": disconnect,
    "capabilities": capabilities,
    "mcp_connect": mcp_connect,
    "mcp_discover": mcp_discover,
    "approve_execution": approve_execution,
    "invoke": invoke,
    "readiness": readiness,
    "readiness_detail": readiness_detail,
}
from app.services.integrations.library_operations import connect_key
OPERATIONS['library_connect_key'] = connect_key
from app.services.integrations.synchronization import operate as synchronize_resource
OPERATIONS['resource_sync'] = synchronize_resource


def operate(settings: IntegrationSettings, caller: CallerContext, *, operation: str, arguments: dict) -> dict:
    handler = OPERATIONS.get(operation)
    if handler is None:
        raise ValidationError("That operation is not available.")
    try:
        return handler(settings, caller, arguments)
    except KeyError as missing:
        raise ValidationError(f"Missing argument: {missing.args[0]}") from missing
