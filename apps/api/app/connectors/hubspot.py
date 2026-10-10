"""HubSpot: one sign-in, reaching contacts, companies and sales pipelines (D56).

Read-only scopes only, as for the suites: this discovers what is reachable and proves the
connection is healthy. A scope that writes arrives with the feature that needs it.
"""

from __future__ import annotations

from app.connectors.base import Account, Capability, OAuthProvider, bounded, limit, text

API = "https://api.hubapi.com"


class HubSpot(OAuthProvider):
    key = "hubspot"
    authorize_endpoint = "https://app.hubspot.com/oauth/authorize"
    token_endpoint = f"{API}/oauth/v1/token"
    scopes = ("oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read")

    capabilities = (
        Capability("crm.contacts.list", "Contacts", "contacts", "crm", properties={"limit": limit(), "after": text("Cursor from a previous page.")}),
        Capability("crm.companies.list", "Companies", "companies", "crm", properties={"limit": limit(), "after": text("Cursor from a previous page.")}),
        Capability("crm.deals.list", "Deals and their pipeline stage", "deals", "crm", properties={"limit": limit(), "after": text("Cursor from a previous page.")}),
        Capability("crm.pipelines.list", "Deal pipelines and their stages", "pipelines", "crm"),
    )

    def _objects(self, access_token: str, kind: str, properties: str, params) -> dict:
        query = {"limit": str(bounded(params, "limit", 25, 100)), "properties": properties}
        if params.get("after"):
            query["after"] = str(params["after"])
        found = self._get(f"{API}/crm/v3/objects/{kind}", access_token, query)
        after = ((found.get("paging") or {}).get("next") or {}).get("after")
        return {"results": [{"id": r.get("id"), **(r.get("properties") or {})} for r in found.get("results", [])], "next_cursor": after}

    def contacts(self, access_token: str, params) -> dict:
        return self._objects(access_token, "contacts", "firstname,lastname,email,phone,lifecyclestage", params)

    def companies(self, access_token: str, params) -> dict:
        return self._objects(access_token, "companies", "name,domain,industry", params)

    def deals(self, access_token: str, params) -> dict:
        return self._objects(access_token, "deals", "dealname,amount,dealstage,pipeline,closedate", params)

    def pipelines(self, access_token: str, params) -> dict:
        found = self._get(f"{API}/crm/v3/pipelines/deals", access_token)
        return {
            "pipelines": [
                {"id": p["id"], "label": p.get("label"), "stages": [{"id": s["id"], "label": s.get("label")} for s in p.get("stages", [])]}
                for p in found.get("results", [])
            ]
        }

    def account(self, access_token: str) -> Account:
        info = self._get(f"{API}/oauth/v1/access-tokens/{access_token}", access_token)
        return Account(label=str(info.get("hub_domain") or info.get("user") or "HubSpot account"))

    def resources(self, access_token: str) -> list[dict]:
        pipelines = self._get(f"{API}/crm/v3/pipelines/deals", access_token)
        return [
            {"resource_type": "hubspot_pipeline", "external_id": str(item["id"]), "display_name": item.get("label") or str(item["id"]), "metadata": {}}
            for item in pipelines.get("results", [])
        ]
