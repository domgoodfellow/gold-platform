import { Button, ButtonLink } from '@/components/controls/button';
import { listMappings } from '@/lib/domain/integrations/mappings';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { libraryNewImportHref, libraryImportHref } from '@/lib/route/library';
import { reviewCrmSyncAction, disableCrmSyncAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';
import {notFound} from 'next/navigation';
import {CollectionHeader} from '@/components/patterns/collection-header';
import {libraryHref} from '@/lib/route/library';
import { LibraryNav } from '@/features/library/library-nav';
import {requireOrganization} from '@/lib/route/organization';
import {getResourceSync,listResourceRecords,listResources} from '@/lib/domain/integrations/resources';
import {SourceRecordPreview} from '@/features/integrations/sources/record-preview';
import {ResourceSyncControl} from '@/features/integrations/sources/resource-sync-control';

export default async function SourcePage({params}:{params:Promise<{organizationId:string;resourceId:string}>}) {
  const {organizationId,resourceId}=await params;
  const {db,organization}=await requireOrganization(organizationId);
  const resource=(await listResources(db,{organizationId})).find(r=>r.id===resourceId);
  if(!resource)notFound();
  const [sync,records]=await Promise.all([getResourceSync(db,organizationId,resourceId),listResourceRecords(db,organizationId,resourceId)]);
  const [mappings, runs, removed] = await Promise.all([listMappings(db,{organizationId,resourceId}), listImportRuns(db,{organizationId}), db.from('integration_resource_records').select('external_id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('resource_id',resourceId).eq('deleted',true)]);
  const connection = resource.connectionId ? await db.from('integration_connections').select('status').eq('organization_id',organizationId).eq('id',resource.connectionId).maybeSingle() : null;
  const connectionStatus = connection?.data?.status ?? (resource.connectionId ? 'unavailable' : 'snapshot');
  const mayImport = organization.capabilities.includes('integration.manage');
  const supported=['google_calendar','google_drive_folder','google_drive','google_sheet','microsoft_calendar','microsoft_drive_folder','microsoft_drive','microsoft_workbook'].includes(resource.resourceType);
  return <>
    <CollectionHeader title={resource.displayName} crumbs={[{label:'Sources',href:libraryHref(organizationId,'sources')}]}/>
    <LibraryNav organizationId={organizationId} active="sources" />
    <p className="mt-4 text-sm text-muted">{resource.resourceType.replaceAll('_',' ')} · {resource.status.replaceAll('_',' ')}</p>
    <p className="mt-2 text-sm text-muted">Connection: {connectionStatus}</p>
    <section className="mt-6"><h2 className="font-medium">Synchronization</h2>
      <p className="mt-1 text-sm">{sync?`${sync.enabled?'Enabled':'Disabled'} · ${sync.state}`:'Not enabled'}</p>
      {sync?.last_success_at?<p className="text-sm text-muted">Last completed: {new Date(sync.last_success_at).toISOString()}</p>:null}
      {sync?.last_error?<p role="alert" className="mt-2 text-sm">{sync.last_error}</p>:null}
      {supported&&resource.status==='active'&&organization.capabilities.includes('integration.manage')?<ResourceSyncControl organizationId={organizationId} resourceId={resourceId} type={resource.resourceType} parameters={(sync?.parameters??{}) as Record<string,unknown>} enabled={sync?.enabled??false}/>:null}
    </section>
    {mayImport && ['file_upload','google_sheet','microsoft_workbook'].includes(resource.resourceType) ? <section className="mt-6 space-y-3">
      <h2 className="font-medium">CRM Contacts</h2><ButtonLink tone="secondary" href={libraryNewImportHref(organizationId, resourceId)}>Import into CRM</ButtonLink>
      {removed.count ? <p role="status" className="text-sm">{removed.count} source rows removed. Canonical CRM contacts and their history are preserved.</p> : null}
      {mappings.filter(mapping => mapping.syncMode === 'sync').map(mapping => {
        const run = runs.find(run => run.mappingId === mapping.id);
        const lastSuccess = runs.find(run => run.mappingId === mapping.id && run.status === 'completed');
        const confirmed = runs.some(run => run.mappingId === mapping.id && ['completed','completed_with_errors'].includes(run.status));
        return <div key={mapping.id} className="space-y-2 rounded border border-border p-3">
          <p className="text-sm">Saved CRM synchronization / {run?.status.replaceAll('_',' ') ?? 'Awaiting initial review'}</p>
          <p className="text-sm text-muted">Last successful CRM import: {lastSuccess?.finishedAt ? new Date(lastSuccess.finishedAt).toISOString() : 'Not completed yet'}</p>
          {run ? <ButtonLink tone="text" href={libraryImportHref(organizationId,run.id)}>Review latest run{run.finishedAt ? ` / ${new Date(run.finishedAt).toISOString()}` : ''}</ButtonLink> : null}
          {confirmed && run?.status !== 'pending' && run?.status !== 'running' ? <form action={reviewCrmSyncAction}>
            <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="resourceId" value={resourceId}/><input type="hidden" name="mappingId" value={mapping.id}/>
            <Button type="submit" tone="secondary" disabled={connectionStatus !== 'active' || !sync?.enabled}>Sync now to CRM</Button>
            <p className="mt-1 text-xs text-muted">Sync now refreshes the worksheet and opens a review before applying CRM updates.</p>
          </form> : <p className="text-sm">Confirm the pending import before synchronizing again.</p>}
          <form action={disableCrmSyncAction}><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="resourceId" value={resourceId}/><input type="hidden" name="mappingId" value={mapping.id}/><Button type="submit" tone="text">Stop CRM synchronization</Button></form>
        </div>;
      })}
    </section> : null}
    {/* ui-copy-allow: factual bound on the records listed, not a description */}
    <section className="mt-8"><h2 className="font-medium">Synchronized records</h2><p className="text-sm text-muted">Showing up to 100 records you have permission to read.</p>
      {records.length?<ul className="mt-3 divide-y divide-border">{records.map(record=><li key={record.external_id} className="py-1"><SourceRecordPreview record={record}/></li>)}</ul>:<p className="mt-3 text-sm text-muted">No synchronized records are available.</p>}
    </section>
  </>;
}
