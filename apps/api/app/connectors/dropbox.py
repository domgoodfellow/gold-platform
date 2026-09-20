"""Dropbox: one sign-in, reaching the top-level folders (D56).

Read-only metadata scopes. Dropbox's API is POST-only and hands out a refresh token only when the
authorize step asks for offline access.
"""

from __future__ import annotations

from app.connectors.base import Account, OAuthApp, OAuthProvider
from app.providers.providers import UpstreamRefused

API = "https://api.dropboxapi.com/2"


class Dropbox(OAuthProvider):
    key = "dropbox"
    authorize_endpoint = "https://www.dropbox.com/oauth2/authorize"
    token_endpoint = "https://api.dropboxapi.com/oauth2/token"
    scopes = ("account_info.read", "files.metadata.read")
    authorize_extra = {"token_access_type": "offline"}

    def account(self, access_token: str) -> Account:
        me = self._post(f"{API}/users/get_current_account", access_token)
        return Account(label=str(me.get("email") or (me.get("name") or {}).get("display_name") or "Dropbox account"))

    def revoke(self, app: OAuthApp, *, token: str) -> None:
        try:
            self._post(f"{API}/auth/token/revoke", token)
        except UpstreamRefused:
            pass  # best effort, as the contract says

    def resources(self, access_token: str) -> list[dict]:
        listing = self._post(f"{API}/files/list_folder", access_token, {"path": "", "limit": 100})
        return [
            {"resource_type": "dropbox_folder", "external_id": item["id"], "display_name": item.get("name") or item["id"], "metadata": {}}
            for item in listing.get("entries", [])
            if item.get(".tag") == "folder"
        ]
