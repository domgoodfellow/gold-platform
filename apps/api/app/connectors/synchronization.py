"""Cursor-based source reconciliation. File bytes are never copied by metadata synchronization."""
from __future__ import annotations
from dataclasses import dataclass
from urllib.parse import quote, urlparse
from app.providers.providers import UpstreamRefused


@dataclass(frozen=True)
class SyncPage:
    records: list[dict]
    cursor: dict
    complete: bool
    snapshot: bool = False


def _record(item, *, deleted=False):
    return {'external_id':str(item['id']),'display_name':str(item.get('name') or item.get('summary') or item.get('subject') or item['id'])[:200],
        'metadata':item,'deleted':deleted}


def _rows(values: list, key_column: int) -> list[dict]:
    if len(values)>501: raise UpstreamRefused('This worksheet selection exceeds 500 rows. Select a smaller range.')
    if not values: return []
    headers=[str(value).strip() for value in values[0]]
    if not all(headers) or len(set(headers))!=len(headers):raise UpstreamRefused('Column names must be nonempty and unique before mapping rows.')
    seen=set(); records=[]
    for row in values[1:]:
        if not any(str(v).strip() for v in row): continue
        if key_column>=len(row) or not str(row[key_column]).strip(): raise UpstreamRefused('Every imported row needs a stable key in the selected key column.')
        key=str(row[key_column])
        if key in seen: raise UpstreamRefused('The worksheet contains duplicate row keys. Resolve them before synchronization.')
        seen.add(key)
        records.append({'external_id':key,'display_name':key[:200],'metadata':{'headers':headers,'values':row},'deleted':False})
    return records


def read_page(provider, token: str, resource_type: str, external_id: str, cursor: dict, params: dict) -> SyncPage:
    q=lambda s:quote(s,safe='')
    if resource_type in ('google_drive_folder','google_drive'):
        if external_id=='root':
            external_id=provider._get('https://www.googleapis.com/drive/v3/files/root',token,{'fields':'id'})['id']
        start=cursor.get('start_token')
        if not cursor or cursor.get('phase')=='initial':
            if not start: start=provider._get('https://www.googleapis.com/drive/v3/changes/startPageToken',token)['startPageToken']
            query={'q':f"'{external_id.replace(chr(39), chr(92)+chr(39))}' in parents and trashed=false",'pageSize':'100',
                'fields':'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,parents,size)'}
            if cursor.get('page'):query['pageToken']=cursor['page']
            result=provider._get('https://www.googleapis.com/drive/v3/files',token,query)
            next_page=result.get('nextPageToken')
            return SyncPage([_record(x) for x in result.get('files',[])],
                {'phase':'initial','page':next_page,'start_token':start} if next_page else {'phase':'changes','page':start},not next_page,True)
        result=provider._get('https://www.googleapis.com/drive/v3/changes',token,{'pageToken':cursor['page'],'pageSize':'100',
            'fields':'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,webViewLink,parents,trashed))'})
        records=[]
        for change in result.get('changes',[]):
            item=change.get('file') or {'id':change['fileId']}
            removed=bool(change.get('removed') or item.get('trashed') or external_id not in item.get('parents',[]))
            records.append(_record(item,deleted=removed))
        return SyncPage(records,{'phase':'changes','page':result.get('nextPageToken') or result['newStartPageToken']},not result.get('nextPageToken'))
    if resource_type=='google_calendar':
        query={'maxResults':'100','showDeleted':'true'}
        if cursor.get('sync_token'):query['syncToken']=cursor['sync_token']
        if cursor.get('page'):query['pageToken']=cursor['page']
        result=provider._get(f'https://www.googleapis.com/calendar/v3/calendars/{q(external_id)}/events',token,query)
        next_page=result.get('nextPageToken')
        state={'page':next_page,'sync_token':cursor.get('sync_token')} if next_page else {'sync_token':result['nextSyncToken']}
        return SyncPage([_record(x,deleted=x.get('status')=='cancelled') for x in result.get('items',[])],state,not next_page,not cursor.get('sync_token'))
    if resource_type=='google_sheet':
        selected=str(params.get('range') or 'Sheet1!A1:Z501')
        result=provider._get(f'https://sheets.googleapis.com/v4/spreadsheets/{q(external_id)}/values/{q(selected)}',token)
        return SyncPage(_rows(result.get('values',[]),int(params.get('key_column',0))),{},True,True)
    if resource_type in ('microsoft_drive_folder','microsoft_drive','microsoft_calendar'):
        if resource_type=='microsoft_calendar':
            start,end=params.get('start'),params.get('end')
            if not start or not end:raise UpstreamRefused('Select a start and end date for calendar synchronization.')
            base=f'https://graph.microsoft.com/v1.0/me/calendars/{q(external_id)}/calendarView/delta'
            query={'startDateTime':start,'endDateTime':end}
        else:
            base=f'https://graph.microsoft.com/v1.0/me/drive/items/{q(external_id)}/delta';query={}
        url=cursor.get('url') or base
        parsed=urlparse(url)
        if parsed.scheme!='https' or parsed.netloc!='graph.microsoft.com' or parsed.path!=urlparse(base).path:
            raise UpstreamRefused('The source returned an invalid synchronization cursor.')
        result=provider._get(url,token,None if cursor.get('url') else query)
        next_url=result.get('@odata.nextLink')
        return SyncPage([_record(x,deleted='deleted' in x or '@removed' in x or x.get('isCancelled',False)) for x in result.get('value',[])],
            {'url':next_url or result['@odata.deltaLink'],'initialized':bool(cursor.get('initialized')) or not bool(next_url)},not next_url,not cursor.get('initialized'))
    if resource_type=='microsoft_workbook':
        worksheet=str(params.get('worksheet') or 'Sheet1');selected=str(params.get('range') or 'A1:Z501')
        result=provider._get(f"https://graph.microsoft.com/v1.0/me/drive/items/{q(external_id)}/workbook/worksheets/{q(worksheet)}/range(address='{q(selected)}')",token)
        return SyncPage(_rows(result.get('values',[]),int(params.get('key_column',0))),{},True,True)
    raise UpstreamRefused('This resource type has no synchronization contract.')
