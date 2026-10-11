"""Microsoft 365: one Microsoft sign-in, reaching Calendar and OneDrive (D56).

Implements exactly the contract `base.OAuthProvider` gives Google, and differs where Microsoft
does: it always rotates the refresh token, has no per-token revocation endpoint, and names its
files and calendars through Graph.
"""

from __future__ import annotations

from urllib.parse import urlparse
from app.providers.providers import UpstreamRefused

from app.connectors.base import Account, Capability, OAuthProvider, bounded, limit, segment, text

GRAPH = "https://graph.microsoft.com/v1.0"


class Microsoft365(OAuthProvider):
    key = "microsoft_365"
    authorize_endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    token_endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    # Graph requires Files.ReadWrite even for Excel range reads; execution remains read-only.
    scopes = ("offline_access", "User.Read", "Calendars.Read", "Files.ReadWrite", "Mail.Read")
    authorize_extra = {"response_mode": "query", "prompt": "select_account"}

    capabilities = (
        Capability("calendar.events.list", "Upcoming events on the default calendar", "list_events", "field", properties={"limit": limit()}),
        Capability("onedrive.files.list", "Files and folders in OneDrive, at the root or in one folder", "list_files", "library", properties={"folder_id": text("Folder id; defaults to the root."), "limit": limit()}),
        Capability("excel.range.get", "Cell values from one worksheet range of a workbook", "workbook_range", "library", properties={"workbook_id": text("The workbook."), "worksheet": text("Worksheet name; defaults to Sheet1."), "range": text("A1 range, e.g. A1:D50.")}, required=("workbook_id",), resource_type="microsoft_workbook", resource_param="workbook_id"),
    )

    def list_events(self, access_token: str, params) -> dict:
        found = self._get(
            f"{GRAPH}/me/events",
            access_token,
            {"$top": str(bounded(params, "limit", 25, 100)), "$select": "id,subject,start,end,isCancelled", "$orderby": "start/dateTime"},
        )
        return {
            "events": [
                {
                    "id": e.get("id"),
                    "title": e.get("subject"),
                    "start": e.get("start"),
                    "end": e.get("end"),
                    "status": "cancelled" if e.get("isCancelled") else "confirmed",
                }
                for e in found.get("value", [])
            ]
        }

    def list_files(self, access_token: str, params) -> dict:
        folder = params.get("folder_id")
        url = f"{GRAPH}/me/drive/items/{segment(folder, 'folder_id')}/children" if folder else f"{GRAPH}/me/drive/root/children"
        found = self._get(url, access_token, {"$top": str(bounded(params, "limit", 25, 100)), "$select": "id,name,size,lastModifiedDateTime,folder,file"})
        return {
            "files": [
                {"id": i.get("id"), "name": i.get("name"), "size": i.get("size"), "modified": i.get("lastModifiedDateTime"), "is_folder": bool(i.get("folder"))}
                for i in found.get("value", [])
            ]
        }

    def workbook_range(self, access_token: str, params) -> dict:
        item = segment(params.get("workbook_id"), "workbook_id")
        sheet = segment(params.get("worksheet") or "Sheet1", "worksheet")
        address = segment(params.get("range") or "A1:Z100", "range")
        found = self._get(f"{GRAPH}/me/drive/items/{item}/workbook/worksheets/{sheet}/range(address='{address}')", access_token)
        return {"address": found.get("address"), "values": found.get("values", [])[:500]}

    # No `revoke`: Microsoft revokes sessions for a whole user, not one token, and doing that to a
    # person's own sign-in for every app is a larger act than disconnecting one. The credential
    # GOLD holds is deleted; the grant is one the person removes in their own account.

    def account(self, access_token: str) -> Account:
        me = self._get(f"{GRAPH}/me", access_token)
        return Account(label=str(me.get("mail") or me.get("userPrincipalName") or me.get("displayName") or "Microsoft account"))

    def resources(self, access_token: str) -> list[dict]:
        def pages(url,params=None):
            result=[]
            for _ in range(20):
                parsed=urlparse(url)
                if parsed.scheme!='https' or parsed.netloc!='graph.microsoft.com':
                    raise UpstreamRefused('The source returned an invalid discovery cursor.')
                page=self._get(url,access_token,params)
                result.extend(page.get('value',[]))
                url=page.get('@odata.nextLink');params=None
                if not url:return result
            raise UpstreamRefused('Resource discovery exceeds the supported page limit. No selections were replaced.')
        found=[]
        for item in pages(f'{GRAPH}/me/calendars'):
            found.append({'resource_type':'microsoft_calendar','external_id':item['id'],
                'display_name':item.get('name') or item['id'],'metadata':{'default':bool(item.get('isDefaultCalendar'))}})
        root=self._get(f'{GRAPH}/me/drive/root',access_token,{'$select':'id,name,webUrl'})
        found.append({'resource_type':'microsoft_drive_folder','external_id':root['id'],'display_name':root.get('name') or 'OneDrive','metadata':{'web_url':root.get('webUrl')}})
        for item in pages(f"{GRAPH}/me/drive/root/search(q='')",{'$top':'100','$select':'id,name,folder,file,webUrl'}):
            if 'folder' in item or str(item.get('name','')).lower().endswith('.xlsx'):
                found.append({'resource_type':'microsoft_drive_folder' if 'folder' in item else 'microsoft_workbook',
                    'external_id':item['id'],'display_name':item.get('name') or item['id'],'metadata':{'web_url':item.get('webUrl')}})
        return found
