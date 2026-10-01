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
import time

import httpx

from app.auth import CallerContext
from app.core import db
from app.core.config import IntegrationSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError, NotFoundError, ValidationError
from app.services.integrations.state import StateInvalid, sign_state, verify_state
from app.connectors import oauth_app_for, oauth_provider_for
from app.connectors.base import OAuthApp, OAuthProvider, Tokens
from app.providers.providers import UpstreamRefused

# A token this close to expiring is refreshed before it is used.
_REFRESH_MARGIN_SECONDS = 120


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


def _pack(tokens: Tokens) -> str:
    return json.dumps(
        {"access_token": tokens.access_token, "refresh_token": tokens.refresh_token, "expires_at": tokens.expires_at}
    )


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
        tokens = provider.exchange(app, code=code, redirect_uri=settings.redirect_uri)
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

    db.store_integration_credential(settings, connection_id=connection_id, secret=_pack(tokens))
    db.record_integration_health(
        settings, connection_id=connection_id, ok=True, account_label=account.label, scopes=tokens.scopes
    )
    _discover(settings, provider, connection_id, tokens.access_token)
    return {"organization_id": organization_id, "connection_id": connection_id}


def _held_credential(settings: IntegrationSettings, connection_id: str) -> dict | None:
    row = db.read_integration_credential(settings, connection_id=connection_id)
    if not row or not row.get("secret"):
        return None
    try:
        return json.loads(row["secret"])
    except json.JSONDecodeError:
        return None


def _discover(settings: IntegrationSettings, provider: OAuthProvider, connection_id: str, access_token: str) -> int:
    """What this authorization can reach. Failing to list is not failing to connect."""
    try:
        resources = provider.resources(access_token)
    except UpstreamRefused:
        return 0
    db.replace_integration_resources(settings, connection_id=connection_id, resources=resources)
    return len(resources)


def sync(settings: IntegrationSettings, caller: CallerContext, arguments: dict) -> dict:
    """Check a connection: rotate its token if it is near expiry, ask who the account is, list what it reaches."""
    connection = _connection(settings, caller, str(arguments.get("connection_id") or ""))
    connection_id = connection["id"]
    provider, app = _client(connection["connector_key"])

    held = _held_credential(settings, connection_id)
    if held is None:
        raise ValidationError("That connection has no credential stored. Reconnect it.")

    try:
        access_token = held["access_token"]
        if int(held.get("expires_at", 0)) - _REFRESH_MARGIN_SECONDS <= int(time.time()):
            if not held.get("refresh_token"):
                raise UpstreamRefused("The sign-in has expired and cannot be renewed. Reconnect it.")
            renewed = provider.refresh(app, refresh_token=held["refresh_token"])
            # Rotation: the new pair replaces the old before anything else uses it.
            db.store_integration_credential(settings, connection_id=connection_id, secret=_pack(renewed))
            access_token, scopes = renewed.access_token, renewed.scopes or None
        else:
            scopes = None
        account = provider.account(access_token)
    except UpstreamRefused as failure:
        db.record_integration_health(settings, connection_id=connection_id, ok=False, error=str(failure))
        raise ProviderRefusedError(str(failure)) from failure

    count = _discover(settings, provider, connection_id, access_token)
    db.record_integration_health(
        settings, connection_id=connection_id, ok=True, account_label=account.label, scopes=scopes
    )
    return {"ok": True, "resources": count}


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


OPERATIONS = {"begin": begin, "complete": complete, "sync": sync, "disconnect": disconnect}


def operate(settings: IntegrationSettings, caller: CallerContext, *, operation: str, arguments: dict) -> dict:
    handler = OPERATIONS.get(operation)
    if handler is None:
        raise ValidationError("That operation is not available.")
    try:
        return handler(settings, caller, arguments)
    except KeyError as missing:
        raise ValidationError(f"Missing argument: {missing.args[0]}") from missing
