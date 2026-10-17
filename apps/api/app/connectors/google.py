"""Google Workspace: one Google sign-in, reaching Calendar and Drive.

Read-only scopes only: this slice discovers what is reachable and proves the connection is
healthy. A scope that writes arrives with the feature that needs it, and asks the person again.
"""

from __future__ import annotations

import httpx

from app.connectors.base import Account, Capability, OAuthApp, OAuthProvider, bounded, limit, segment, text
from app.providers.providers import UpstreamRefused


class GoogleWorkspace(OAuthProvider):
    key = "google_workspace"
    authorize_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    token_endpoint = "https://oauth2.googleapis.com/token"
    scopes = (
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/contacts.readonly",
    )
    # Offline access is what yields a refresh token; consent is what makes Google return one again on a reconnect.
    authorize_extra = {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}

    capabilities = (
        Capability("calendar.events.list", "Upcoming events on one calendar", "list_events", "field", properties={"calendar_id": text("Calendar id; defaults to the primary calendar."), "time_min": text("Only events after this RFC 3339 time."), "limit": limit()}, resource_type="google_calendar", resource_param="calendar_id"),
        Capability("drive.files.list", "Files in Drive, optionally matching a name", "list_files", "library", properties={"name_contains": text("Only files whose name contains this."), "limit": limit()}),
        Capability("sheets.values.get", "Cell values from one range of a spreadsheet", "sheet_values", "library", properties={"spreadsheet_id": text("The spreadsheet."), "range": text("A1 range, e.g. A1:D50.")}, required=("spreadsheet_id",), resource_type="google_sheet", resource_param="spreadsheet_id"),
    )

    def list_events(self, access_token: str, params) -> dict:
        calendar = segment(params.get("calendar_id") or "primary", "calendar_id")
        query = {"maxResults": str(bounded(params, "limit", 25, 100)), "singleEvents": "true", "orderBy": "startTime"}
        if params.get("time_min"):
            query["timeMin"] = str(params["time_min"])
        found = self._get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar}/events", access_token, query)
        return {
            "events": [
                {"id": e.get("id"), "title": e.get("summary"), "start": e.get("start"), "end": e.get("end"), "status": e.get("status")}
                for e in found.get("items", [])
            ]
        }

    def list_files(self, access_token: str, params) -> dict:
        name = str(params.get("name_contains") or "").replace("\\", "\\\\").replace("'", "\\'")
        query = {
            "pageSize": str(bounded(params, "limit", 25, 100)),
            "fields": "files(id,name,mimeType,modifiedTime)",
            "q": "trashed=false" + (f" and name contains '{name}'" if name else ""),
        }
        found = self._get("https://www.googleapis.com/drive/v3/files", access_token, query)
        return {"files": found.get("files", [])}

    def sheet_values(self, access_token: str, params) -> dict:
        sheet = segment(params.get("spreadsheet_id"), "spreadsheet_id")
        cell_range = segment(params.get("range") or "A1:Z100", "range")
        found = self._get(f"https://sheets.googleapis.com/v4/spreadsheets/{sheet}/values/{cell_range}", access_token)
        return {"range": found.get("range"), "values": found.get("values", [])[:500]}

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
        def pages(url, params, collection):
            result=[]
            for _ in range(20):
                page=self._get(url,access_token,params)
                result.extend(page.get(collection,[]))
                if not page.get('nextPageToken'):return result
                params={**params,'pageToken':page['nextPageToken']}
            raise UpstreamRefused('Resource discovery exceeds the supported page limit. No selections were replaced.')
        for item in pages('https://www.googleapis.com/calendar/v3/users/me/calendarList',{'maxResults':'100'},'items'):
            found.append({'resource_type':'google_calendar','external_id':item['id'],
                'display_name':item.get('summary') or item['id'],'metadata':{'primary':bool(item.get('primary'))}})
        found.append({'resource_type':'google_drive_folder','external_id':'root','display_name':'My Drive','metadata':{}})
        files=pages('https://www.googleapis.com/drive/v3/files',{
            'q':"(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.folder') and trashed=false",
            'pageSize':'100','fields':'nextPageToken,files(id,name,mimeType,webViewLink)'},'files')
        for item in files:
            found.append({'resource_type':'google_sheet' if item.get('mimeType')=='application/vnd.google-apps.spreadsheet' else 'google_drive_folder',
                'external_id':item['id'],'display_name':item.get('name') or item['id'],'metadata':{'web_url':item.get('webViewLink')}})
        return found
