"""Slack: one workspace install, reaching the public channels GOLD may post to (D56).

Slack answers a refusal with HTTP 200 and `ok: false`, so each read checks the flag rather than
the status. A bot token does not expire, so there is nothing to refresh.
"""

from __future__ import annotations

from app.connectors.base import Account, Capability, CapabilityInputError, OAuthApp, OAuthProvider, bounded
from app.providers.providers import UpstreamRefused

API = "https://slack.com/api"


def _checked(payload: dict) -> dict:
    if payload.get("ok") is False:
        raise UpstreamRefused(f"The provider refused the request: {str(payload.get('error') or 'unknown')[:300]}")
    return payload


class Slack(OAuthProvider):
    key = "slack"
    authorize_endpoint = "https://slack.com/oauth/v2/authorize"
    token_endpoint = f"{API}/oauth.v2.access"
    scopes = ("channels:read", "channels:history", "chat:write")
    default_expires_in = 10 * 365 * 24 * 3600
    capabilities = (
        Capability("slack.channels.list", "Public channels in the workspace", "channels", "communications"),
        Capability("slack.messages.history", "Recent messages in one channel GildOps has joined", "history", "communications"),
    )

    def channels(self, access_token: str, params) -> dict:
        return {"channels": [{"id": r["external_id"], "name": r["display_name"]} for r in self.resources(access_token)]}

    def history(self, access_token: str, params) -> dict:
        channel = str(params.get("channel_id") or "")
        if not channel:
            raise CapabilityInputError("channel_id is required.")
        found = _checked(self._get(f"{API}/conversations.history", access_token, {"channel": channel, "limit": str(bounded(params, "limit", 25, 100))}))
        return {"messages": [{"ts": m.get("ts"), "user": m.get("user"), "text": m.get("text")} for m in found.get("messages", [])]}

    def account(self, access_token: str) -> Account:
        info = _checked(self._get(f"{API}/auth.test", access_token))
        return Account(label=str(info.get("team") or "Slack workspace"))

    def revoke(self, app: OAuthApp, *, token: str) -> None:
        try:
            self._post(f"{API}/auth.revoke", token)
        except UpstreamRefused:
            pass  # best effort, as the contract says

    def resources(self, access_token: str) -> list[dict]:
        channels = _checked(
            self._get(f"{API}/conversations.list", access_token, {"types": "public_channel", "exclude_archived": "true", "limit": "200"})
        )
        return [
            {"resource_type": "slack_channel", "external_id": item["id"], "display_name": f"#{item.get('name') or item['id']}", "metadata": {}}
            for item in channels.get("channels", [])
        ]
