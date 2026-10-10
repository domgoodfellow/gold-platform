"""Cloudflare: one sign-in to the account that owns a business's own DNS (D56, work order 1).

**Tenant-owned, never a GildOps provider account.** The Cloudflare account connected here belongs
to the business, not to GildOps (D33) -- the opposite ownership from the Vercel hosting account
`app.providers.vercel` speaks to (D44/D62). This file only runs the handshake and lists the zones
the authorization can reach, exactly like every other connector; writing a DNS record is a
separate, narrower capability in `app.services.dns`, reached only through an active connection
this file produced.

**Scopes are Cloudflare's own OAuth permission-group names, not a guess.** Cloudflare's OAuth
client documentation states plainly: "OAuth scope names correspond to Cloudflare API token
permission names," in the dotted `{resource}.{read|write}` shape its own examples use
(`zone.read`, `user-details.read`, `workers-scripts.write`). `zone.read` is what `resources()`
discovers zones with; `dns.read`/`dns.write` are the paired permission group `app.services.dns`
reads and writes records through; `user-details.read` is what `account()` names the signed-in
person with. No account-wide or billing scope, because nothing here calls an `/accounts` endpoint.
**Confirm against a live client before relying on this**: Cloudflare's own canonical source is the
authenticated `GET /client/v4/oauth/scopes` endpoint, which this deployment cannot call without a
Cloudflare API token already in hand, and at least one open Cloudflare-side report describes the
"DNS Read" consent name not reliably covering the zone DNS-records endpoint in every case.

**Confidential client: PKCE is optional, not required.** Cloudflare requires PKCE only for a
public client with no client secret (`none` token-endpoint auth); this connector authenticates
with GildOps' own client secret (`client_secret_post`, the base contract's `_token_request`), the
row the documentation calls out as the one combination PKCE is optional for.
"""

from __future__ import annotations

import httpx

from app.connectors.base import Account, Capability, OAuthProvider, bounded, segment
from app.providers.providers import MalformedAnswer, UpstreamRefused

API = "https://api.cloudflare.com/client/v4"


def cloudflare_error_message(body: dict, status_code: int) -> str:
    """Cloudflare's own words from its `errors` array, kept short (I25) -- the one place both this
    connector and `app.services.dns.cloudflare` read that shape from, so neither collapses a
    refusal to a bare status code where the vendor said something more useful."""
    errors = body.get("errors") if isinstance(body, dict) else None
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        return str(errors[0].get("message") or f"status {status_code}")[:300]
    return f"status {status_code}"


class Cloudflare(OAuthProvider):
    key = "cloudflare"
    # Cloudflare's own OAuth app endpoints (the same ones its own CLI tooling signs in through).
    authorize_endpoint = "https://dash.cloudflare.com/oauth2/auth"
    token_endpoint = "https://dash.cloudflare.com/oauth2/token"
    # Permission-group scopes, least privilege for DNS discovery and reconciliation only.
    scopes = ("zone.read", "dns.read", "dns.write", "user-details.read")

    capabilities = (
        Capability("cloudflare.zones.list", "Zones the authorization reaches", "zones", "studio"),
        Capability("cloudflare.dns.records.list", "DNS records of one zone", "dns_records", "studio"),
    )

    def zones(self, access_token: str, params) -> dict:
        return {"zones": [{"id": z["external_id"], "name": z["display_name"], **z["metadata"]} for z in self.resources(access_token)]}

    def dns_records(self, access_token: str, params) -> dict:
        zone = segment(params.get("zone_id"), "zone_id")
        answer = self._call("GET", f"{API}/zones/{zone}/dns_records", access_token, {"per_page": str(bounded(params, "limit", 50, 100))})
        return {"records": [{k: r.get(k) for k in ("id", "type", "name", "content", "ttl", "proxied")} for r in answer.get("result") or []]}

    def _call(self, method: str, url: str, access_token: str, params: dict | None = None) -> dict:
        try:
            response = httpx.request(
                method, url, headers={"Authorization": f"Bearer {access_token}"}, params=params, timeout=15.0
            )
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"cloudflare could not be reached: {type(failure).__name__}") from failure
        try:
            body = response.json()
        except ValueError as failure:
            raise MalformedAnswer("Cloudflare answered with something that is not JSON.") from failure
        if not isinstance(body, dict):
            raise MalformedAnswer("Cloudflare answered with an unexpected shape.")
        if response.status_code >= 400 or body.get("success") is False:
            raise UpstreamRefused(f"Cloudflare refused the request: {cloudflare_error_message(body, response.status_code)}")
        return body

    def account(self, access_token: str) -> Account:
        me = self._call("GET", f"{API}/user", access_token)
        result = me.get("result") if isinstance(me.get("result"), dict) else {}
        label = result.get("email") or result.get("username") or "Cloudflare account"
        return Account(label=str(label))

    def resources(self, access_token: str) -> list[dict]:
        """Every zone this authorization can reach -- one DNS automation can ever write into."""
        found: list[dict] = []
        page = 1
        while True:
            answer = self._call(
                "GET", f"{API}/zones", access_token, {"page": str(page), "per_page": "50", "status": "active"}
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
