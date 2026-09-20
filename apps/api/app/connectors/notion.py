"""Notion: one sign-in, reaching the databases a person shared with GOLD (D56).

Notion differs from the suites in three ways, all held here: it exchanges a code with HTTP Basic
credentials and a JSON body, its tokens never expire and are never refreshed, and every call
carries a version header. The person chooses which pages GOLD sees on Notion's own consent screen,
so what `resources` returns is exactly what they shared.
"""

from __future__ import annotations

import base64
import time

import httpx

from app.connectors.base import Account, OAuthApp, OAuthProvider, Tokens, _json
from app.providers.providers import UpstreamRefused

API = "https://api.notion.com/v1"
VERSION = {"Notion-Version": "2022-06-28"}
_TEN_YEARS = 10 * 365 * 24 * 3600


class Notion(OAuthProvider):
    key = "notion"
    authorize_endpoint = "https://api.notion.com/v1/oauth/authorize"
    token_endpoint = f"{API}/oauth/token"
    # Notion has no scope parameter; access is what the person picks on its consent screen.
    scopes = ()
    authorize_extra = {"owner": "user"}
    default_expires_in = _TEN_YEARS

    def _token_request(self, app: OAuthApp, form: dict[str, str]) -> Tokens:
        basic = base64.b64encode(f"{app.client_id}:{app.client_secret}".encode()).decode()
        try:
            response = httpx.post(
                self.token_endpoint,
                json=form,
                headers={"Authorization": f"Basic {basic}", **VERSION},
                timeout=15.0,
            )
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"{self.key} could not be reached: {type(failure).__name__}") from failure
        payload = _json(response)
        if response.status_code >= 400 or "access_token" not in payload:
            words = payload.get("error_description") or payload.get("error") or f"status {response.status_code}"
            raise UpstreamRefused(f"The provider refused the sign-in: {str(words)[:300]}")
        return Tokens(payload["access_token"], None, int(time.time()) + _TEN_YEARS, [])

    def account(self, access_token: str) -> Account:
        me = self._get(f"{API}/users/me", access_token, headers=VERSION)
        bot = me.get("bot") if isinstance(me.get("bot"), dict) else {}
        return Account(label=str(bot.get("workspace_name") or me.get("name") or "Notion workspace"))

    def resources(self, access_token: str) -> list[dict]:
        found = self._post(
            f"{API}/search",
            access_token,
            {"filter": {"property": "object", "value": "database"}, "page_size": 50},
            headers=VERSION,
        )
        resources: list[dict] = []
        for item in found.get("results", []):
            title = "".join(part.get("plain_text", "") for part in item.get("title", [])) or item["id"]
            resources.append({"resource_type": "notion_database", "external_id": item["id"], "display_name": title, "metadata": {}})
        return resources
