"""Google Workspace: one Google sign-in, reaching Calendar and Drive (D56).

Read-only scopes only: this slice discovers what is reachable and proves the connection is
healthy. A scope that writes arrives with the feature that needs it, and asks the person again.
"""

from __future__ import annotations

import httpx

from app.integrations.oauth.base import Account, OAuthApp, OAuthProvider
from app.integrations.providers import UpstreamRefused


class GoogleWorkspace(OAuthProvider):
    key = "google_workspace"
    authorize_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    token_endpoint = "https://oauth2.googleapis.com/token"
    scopes = (
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
    )
    # Offline access is what yields a refresh token; consent is what makes Google return one again on a reconnect.
    authorize_extra = {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}

    def account(self, access_token: str) -> Account:
        me = self._get("https://openidconnect.googleapis.com/v1/userinfo", access_token)
        return Account(label=str(me.get("email") or me.get("name") or "Google account"))

    def revoke(self, app: OAuthApp, *, token: str) -> None:
        try:
            httpx.post("https://oauth2.googleapis.com/revoke", data={"token": token}, timeout=10.0)
        except httpx.HTTPError as failure:
            raise UpstreamRefused(f"google_workspace could not be reached: {type(failure).__name__}") from failure

    def resources(self, access_token: str) -> list[dict]:
        found: list[dict] = []

        calendars = self._get("https://www.googleapis.com/calendar/v3/users/me/calendarList", access_token)
        for item in calendars.get("items", []):
            found.append(
                {
                    "resource_type": "google_calendar",
                    "external_id": item["id"],
                    "display_name": item.get("summary") or item["id"],
                    "metadata": {"primary": bool(item.get("primary"))},
                }
            )

        sheets = self._get(
            "https://www.googleapis.com/drive/v3/files",
            access_token,
            {
                "q": "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                "pageSize": "50",
                "fields": "files(id,name)",
            },
        )
        for item in sheets.get("files", []):
            found.append(
                {"resource_type": "google_sheet", "external_id": item["id"], "display_name": item.get("name") or item["id"], "metadata": {}}
            )

        return found
