"""Which vendor implementation answers for a connector key, and GOLD's registration with it.

**The one place a connector key is turned into an OAuth implementation** (I15, as
`app.integrations.providers` is for provider keys). `app.domains.integrations` asks for a provider
by key and never imports a vendor. A connector with no entry here, or no client credentials in
this deployment's environment, is refused rather than guessed at.
"""

from __future__ import annotations

import os

from app.integrations.oauth.base import OAuthApp, OAuthProvider

# connector key -> (implementation, environment variable prefix). Data, not a branch.
_REGISTRY: dict[str, tuple[str, str, str]] = {
    "google_workspace": ("app.integrations.oauth.google", "GoogleWorkspace", "GOOGLE_OAUTH"),
    "microsoft_365": ("app.integrations.oauth.microsoft", "Microsoft365", "MICROSOFT_OAUTH"),
}


def oauth_provider_for(connector_key: str) -> OAuthProvider | None:
    entry = _REGISTRY.get(connector_key)
    if entry is None:
        return None
    import importlib

    module, cls, _ = entry
    return getattr(importlib.import_module(module), cls)()


def oauth_app_for(connector_key: str) -> OAuthApp | None:
    """GOLD's client id and secret for this vendor, or `None` when this deployment has none."""
    entry = _REGISTRY.get(connector_key)
    if entry is None:
        return None
    prefix = entry[2]
    client_id = os.environ.get(f"{prefix}_CLIENT_ID")
    client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    return OAuthApp(client_id=client_id, client_secret=client_secret)
