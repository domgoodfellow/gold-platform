"""Cloudflare: one sign-in to the account that owns a business's own DNS (D56, work order 1).

**Tenant-owned, never a GildOps provider account.** The Cloudflare account connected here belongs
to the business, not to GildOps (D33) -- the opposite ownership from the Vercel hosting account
`app.providers.vercel` speaks to (D44/D62). This file only runs the handshake and lists the zones
the authorization can reach, exactly like every other connector; writing a DNS record is a
separate, narrower capability in `app.services.dns`, reached only through an active connection
this file produced.

Read-only discovery scopes plus the one write scope DNS record management needs. `zone:read` and
`dns_records:read` are what `resources()` and a later reconciliation read with; `dns_records:edit`
is the one write scope requested, and nothing wider -- no account-level admin, no billing, no
other product's scope.
"""

from __future__ import annotations

from app.connectors.base import Account, OAuthProvider


class Cloudflare(OAuthProvider):
    key = "cloudflare"
    # Cloudflare's own OAuth app endpoints (the same ones its own CLI tooling signs in through).
    authorize_endpoint = "https://dash.cloudflare.com/oauth2/auth"
    token_endpoint = "https://dash.cloudflare.com/oauth2/token"
    # Permission-group scopes, least privilege for DNS discovery and reconciliation only.
    scopes = ("account:read", "zone:read", "dns_records:read", "dns_records:edit", "user:read")

    def account(self, access_token: str) -> Account:
        me = self._get("https://api.cloudflare.com/client/v4/user", access_token)
        result = me.get("result") if isinstance(me.get("result"), dict) else {}
        label = result.get("email") or result.get("username") or "Cloudflare account"
        return Account(label=str(label))

    def resources(self, access_token: str) -> list[dict]:
        """Every zone this authorization can reach -- one DNS automation can ever write into."""
        found: list[dict] = []
        page = 1
        while True:
            answer = self._get(
                "https://api.cloudflare.com/client/v4/zones",
                access_token,
                {"page": str(page), "per_page": "50", "status": "active"},
            )
            for zone in answer.get("result") or []:
                if not isinstance(zone, dict) or not zone.get("id") or not zone.get("name"):
                    continue
                found.append(
                    {
                        "resource_type": "cloudflare_zone",
                        "external_id": zone["id"],
                        "display_name": zone["name"],
                        "metadata": {"status": zone.get("status")},
                    }
                )
            info = answer.get("result_info") if isinstance(answer.get("result_info"), dict) else {}
            if not info or page >= int(info.get("total_pages") or 1):
                break
            page += 1
        return found
