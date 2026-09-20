"""HubSpot: one sign-in, reaching contacts, companies and sales pipelines (D56).

Read-only scopes only, as for the suites: this discovers what is reachable and proves the
connection is healthy. A scope that writes arrives with the feature that needs it.
"""

from __future__ import annotations

from app.connectors.base import Account, OAuthProvider

API = "https://api.hubapi.com"


class HubSpot(OAuthProvider):
    key = "hubspot"
    authorize_endpoint = "https://app.hubspot.com/oauth/authorize"
    token_endpoint = f"{API}/oauth/v1/token"
    scopes = ("oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read")

    def account(self, access_token: str) -> Account:
        info = self._get(f"{API}/oauth/v1/access-tokens/{access_token}", access_token)
        return Account(label=str(info.get("hub_domain") or info.get("user") or "HubSpot account"))

    def resources(self, access_token: str) -> list[dict]:
        pipelines = self._get(f"{API}/crm/v3/pipelines/deals", access_token)
        return [
            {"resource_type": "hubspot_pipeline", "external_id": str(item["id"]), "display_name": item.get("label") or str(item["id"]), "metadata": {}}
            for item in pipelines.get("results", [])
        ]
