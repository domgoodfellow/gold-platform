from app.connectors.synchronization import _rows, read_page
from app.providers.providers import UpstreamRefused
import pytest


def test_rows_require_stable_unique_keys_and_preserve_headers():
    assert _rows([['id','name'],['42','Alice'],['','']],0)==[{'external_id':'42','display_name':'42','metadata':{'headers':['id','name'],'values':['42','Alice']},'deleted':False}]
    with pytest.raises(UpstreamRefused,match='duplicate'):_rows([['id'],['42'],['42']],0)
    with pytest.raises(UpstreamRefused,match='stable key'):_rows([['id','name'],['','Alice']],0)
    with pytest.raises(UpstreamRefused,match='500'):_rows([['id']]+[[str(i)] for i in range(501)],0)


class Provider:
    def __init__(self,pages):self.pages=iter(pages);self.calls=[]
    def _get(self,url,token,params=None):self.calls.append((url,params));return next(self.pages)


def test_drive_initial_snapshot_captures_change_token_before_paging():
    provider=Provider([{'startPageToken':'start'},{'files':[{'id':'file','name':'A'}],'nextPageToken':'page2'}])
    page=read_page(provider,'token','google_drive_folder','folder',{}, {})
    assert page.snapshot and not page.complete
    assert page.cursor=={'phase':'initial','page':'page2','start_token':'start'}
    provider=Provider([{'files':[{'id':'file2','name':'B'}]}])
    finished=read_page(provider,'token','google_drive_folder','folder',page.cursor,{})
    assert finished.complete and finished.cursor=={'phase':'changes','page':'start'}
    assert provider.calls[0][1]['pageToken']=='page2'


def test_drive_tombstones_removals_and_moves_out_of_selected_folder():
    provider=Provider([{'newStartPageToken':'next','changes':[{'fileId':'deleted','removed':True},{'file':{'id':'moved','parents':['elsewhere']}}]}])
    page=read_page(provider,'token','google_drive_folder','selected',{'phase':'changes','page':'start'},{})
    assert all(record['deleted'] for record in page.records)
    assert page.complete and not page.snapshot


def test_graph_cursor_cannot_send_the_token_to_another_host():
    provider=Provider([])
    with pytest.raises(UpstreamRefused,match='invalid synchronization cursor'):
        read_page(provider,'token','microsoft_drive_folder','folder',{'url':'https://attacker.example/delta'},{})
    assert provider.calls==[]


def test_calendar_keeps_sync_token_while_paging_and_marks_cancelled_events():
    provider=Provider([{'nextPageToken':'second','items':[{'id':'event','status':'cancelled'}]}])
    page=read_page(provider,'token','google_calendar','cal',{'sync_token':'sync'},{})
    assert page.cursor=={'page':'second','sync_token':'sync'}
    assert page.records[0]['deleted'] and not page.snapshot


def test_graph_incremental_paging_never_becomes_a_full_snapshot():
    base='https://graph.microsoft.com/v1.0/me/drive/items/folder/delta'
    provider=Provider([{'value':[],'@odata.nextLink':base+'?page=2'},{'value':[],'@odata.deltaLink':base+'?delta=new'}])
    first=read_page(provider,'token','microsoft_drive_folder','folder',{'url':base+'?delta=old','initialized':True},{})
    last=read_page(provider,'token','microsoft_drive_folder','folder',first.cursor,{})
    assert not first.snapshot and not last.snapshot and last.complete
