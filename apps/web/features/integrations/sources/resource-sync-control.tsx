'use client';
import {useActionState} from 'react';
import {Button} from '@/components/controls/button';
import {ErrorText,TextInput} from '@/components/controls/inputs';
import {syncLibraryResource} from '@/app/organizations/[organizationId]/settings/connections/library-actions';

export function ResourceSyncControl({organizationId,resourceId,type,parameters,enabled}:{
  organizationId:string;resourceId:string;type:string;parameters:Record<string,unknown>;enabled:boolean;
}) {
  const [state,action,pending]=useActionState(syncLibraryResource,{error:null,message:null});
  const sheet=type==='google_sheet'||type==='microsoft_workbook';
  return <form action={action} className="mt-4 max-w-xl space-y-4">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="resourceId" value={resourceId}/>
    {sheet?<>
      <label className="block text-sm">Range<TextInput className="mt-1 w-full" name="range" required defaultValue={String(parameters.range??(type==='google_sheet'?'Sheet1!A1:Z501':'A1:Z501'))}/></label>
      {type==='microsoft_workbook'?<label className="block text-sm">Worksheet<TextInput className="mt-1 w-full" name="worksheet" required defaultValue={String(parameters.worksheet??'Sheet1')}/></label>:null}
      <label className="block text-sm">Stable key column (first column is 0)<TextInput className="mt-1 w-full" type="number" min={0} max={100} name="key_column" required defaultValue={Number(parameters.key_column??0)}/></label>
      <p className="text-sm text-muted">The first row supplies column names. Select at most 500 data rows. Each row needs a unique, stable key. Synchronization updates changed rows and removes rows no longer in the selection.</p>
    </>:null}
    {type==='microsoft_calendar'?<>
      <label className="block text-sm">Start date and time<TextInput name="start" className="mt-1 w-full" required placeholder="2026-10-01T00:00:00Z" defaultValue={String(parameters.start??'')}/></label>
      <label className="block text-sm">End date and time<TextInput name="end" className="mt-1 w-full" required placeholder="2027-01-01T00:00:00Z" defaultValue={String(parameters.end??'')}/></label>
    </>:null}
    <div className="flex flex-wrap gap-3"><Button name="intent" value="enable" disabled={pending}>{pending?'Synchronizing…':enabled?'Synchronize now':'Enable synchronization'}</Button>
      {enabled?<Button name="intent" value="disable" disabled={pending}>Disable synchronization</Button>:null}</div>
    <ErrorText role="alert">{state.error}</ErrorText>{state.message?<p role="status" className="text-sm">{state.message}</p>:null}
  </form>;
}
