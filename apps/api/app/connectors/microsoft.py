"""Microsoft 365: one Microsoft sign-in, reaching Calendar and OneDrive (D56).

Implements exactly the contract `base.OAuthProvider` gives Google, and differs where Microsoft
does: it always rotates the refresh token, has no per-token revocation endpoint, and names its
files and calendars through Graph.
"""

from __future__ import annotations

from app.connectors.base import Account, OAuthProvider

GRAPH = "https://graph.microsoft.com/v1.0"


class Microsoft365(OAuthProvider):
    key = "microsoft_365"
    authorize_endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    token_endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    scopes = ("offline_access", "User.Read", "Calendars.Read", "Files.Read")
    authorize_extra = {"response_mode": "query", "prompt": "select_account"}

    # No `revoke`: Microsoft revokes sessions for a whole user, not one token, and doing that to a
    # person's own sign-in for every app is a larger act than disconnecting one. The credential
    # GOLD holds is deleted; the grant is one the person removes in their own account.

    def account(self, access_token: str) -> Account:
        me = self._get(f"{GRAPH}/me", access_token)
        return Account(label=str(me.get("mail") or me.get("userPrincipalName") or me.get("displayName") or "Microsoft account"))

    def resources(self, access_token: str) -> list[dict]:
        found: list[dict] = []

        for item in self._get(f"{GRAPH}/me/calendars", access_token).get("value", []):
            found.append(
                {
                    "resource_type": "microsoft_calendar",
                    "external_id": item["id"],
                    "display_name": item.get("name") or item["id"],
                    "metadata": {"default": bool(item.get("isDefaultCalendar"))},
                }
            )

        workbooks = self._get(f"{GRAPH}/me/drive/root/search(q='.xlsx')", access_token, {"$top": "50", "$select": "id,name"})
        for item in workbooks.get("value", []):
            found.append(
                {"resource_type": "microsoft_workbook", "external_id": item["id"], "display_name": item.get("name") or item["id"], "metadata": {}}
            )

        return found
