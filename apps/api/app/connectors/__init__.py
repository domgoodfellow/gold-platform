"""Which vendor implementation answers for a connector key, and GOLD's registration with it.

**The one place a connector key is turned into an OAuth implementation** (the no-vendor-SDK-in-domain rule, as
`app.providers.providers` is for provider keys). `app.domains.integrations` asks for a provider
by key and never imports a vendor. A connector with no entry here, or no client credentials in
this deployment's environment, is refused rather than guessed at.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from app.connectors.base import OAuthApp, OAuthProvider

# connector key -> (implementation, class, environment variable prefix, further registration inputs).
# Data, not a branch. A vendor needing more than a client id and secret names the rest here, and the
# connector is not configured -- so not offered to anyone -- until every one of them is present.
_REGISTRY: dict[str, tuple[str, str, str, tuple[str, ...]]] = {
    "google_workspace": ("app.connectors.google", "GoogleWorkspace", "GOOGLE_OAUTH", ()),
    "microsoft_365": ("app.connectors.microsoft", "Microsoft365", "MICROSOFT_OAUTH", ()),
    "hubspot": ("app.connectors.hubspot", "HubSpot", "HUBSPOT_OAUTH", ()),
    "notion": ("app.connectors.notion", "Notion", "NOTION_OAUTH", ()),
    "slack": ("app.connectors.slack", "Slack", "SLACK_OAUTH", ()),
    "dropbox": ("app.connectors.dropbox", "Dropbox", "DROPBOX_OAUTH", ()),
    "cloudflare": ("app.connectors.cloudflare", "Cloudflare", "CLOUDFLARE_OAUTH", ()),
    # A GitHub App, not an OAuth App: access is per installation and per repository, which is the
    # authorization model a business can narrow and revoke. `_CLIENT_ID/_SECRET` are the App's own,
    # used once to prove who is installing; the rest let GildOps act as the installation.
    "github": (
        "app.connectors.github",
        "GitHub",
        "GITHUB_APP",
        ("GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY"),
    ),
}


def oauth_provider_for(connector_key: str) -> OAuthProvider | None:
    entry = _REGISTRY.get(connector_key)
    if entry is None:
        from app.connectors.library import provider_for
        return provider_for(connector_key)
    import importlib

    module, cls = entry[0], entry[1]
    return getattr(importlib.import_module(module), cls)()


@dataclass(frozen=True)
class Readiness:
    """Whether this deployment can complete a sign-in for one connector -- a fact about the
    deployment, never about a business's connection to it and never about the catalogue's status.

    `reason` is a coarse code and safe for any signed-in caller. `required_configuration` names the
    environment inputs and is for platform staff only; no value of any of them is ever carried.
    """

    connector_key: str
    implemented: bool
    configured: bool
    reason: str | None
    required_configuration: tuple[str, ...]

    @property
    def operational(self) -> bool:
        return self.implemented and self.configured


def registered_connector_keys() -> list[str]:
    from app.connectors.library import APPLICATIONS
    return sorted(set(_REGISTRY) | {a['connector_key'] for a in APPLICATIONS})


MCP_CONNECTOR_KEY = "mcp_server"
MCP_EGRESS_DECLARATION = "GILDOPS_MCP_CUSTOM_ENDPOINTS"


def readiness_of(connector_key: str) -> Readiness:
    """`adapter_missing`, `oauth_client_missing`, or ready -- the three answers, derived rather than stored.

    An MCP server is not an OAuth app: there is no vendor registration to hold. What a deployment must
    declare instead is that outbound traffic from this runtime is filtered by the network (see
    `app.connectors.mcp`), and until it does, a business cannot be asked for a server address.
    """
    if connector_key == MCP_CONNECTOR_KEY:
        declared = os.environ.get(MCP_EGRESS_DECLARATION) == "enabled-behind-egress-controls"
        return Readiness(
            connector_key,
            implemented=True,
            configured=declared,
            reason=None if declared else "egress_controls_not_declared",
            required_configuration=(MCP_EGRESS_DECLARATION,),
        )
    entry = _REGISTRY.get(connector_key)
    if entry is None:
        from app.connectors.library import application_for, configured, oauth_app
        app = application_for(connector_key)
        if app is None:
            return Readiness(connector_key, implemented=False, configured=False, reason="adapter_missing", required_configuration=())
        auth = app['auth']['type']
        usable = configured() and ((auth == 'api_key' and app['auth'].get('verifiable')) or (auth == 'oauth2' and oauth_app(connector_key) is not None))
        required = ('GILDOPS_LIBRARY_URL','GILDOPS_LIBRARY_SECRET')
        if auth=='oauth2': required += (f'{connector_key.upper()}_OAUTH_CLIENT_ID',f'{connector_key.upper()}_OAUTH_CLIENT_SECRET')
        return Readiness(connector_key,auth!='custom',usable,None if usable else 'adapter_missing' if auth=='custom' else 'oauth_client_missing',required)
    prefix, further = entry[2], entry[3]
    required = (f"{prefix}_CLIENT_ID", f"{prefix}_CLIENT_SECRET", *further)
    configured = oauth_app_for(connector_key) is not None
    return Readiness(
        connector_key,
        implemented=True,
        configured=configured,
        reason=None if configured else "oauth_client_missing",
        required_configuration=required,
    )


def oauth_app_for(connector_key: str) -> OAuthApp | None:
    """GOLD's client id and secret for this vendor, or `None` when this deployment has none."""
    entry = _REGISTRY.get(connector_key)
    if entry is None:
        from app.connectors.library import oauth_app
        return oauth_app(connector_key)
    prefix, further = entry[2], entry[3]
    client_id = os.environ.get(f"{prefix}_CLIENT_ID")
    client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    extra = {name: os.environ.get(name, "") for name in further}
    if not all(extra.values()):
        return None
    return OAuthApp(client_id=client_id, client_secret=client_secret, extra=extra)


def library_runtime_configuration() -> tuple[str | None,str | None]:
    return os.environ.get('GILDOPS_LIBRARY_URL'),os.environ.get('GILDOPS_LIBRARY_SECRET')


def library_oauth_app(key: str) -> OAuthApp | None:
    prefix=f'{key.upper()}_OAUTH'
    client,secret=os.environ.get(f'{prefix}_CLIENT_ID'),os.environ.get(f'{prefix}_CLIENT_SECRET')
    return OAuthApp(client,secret) if client and secret else None
