import {notFound} from 'next/navigation';
import {CollectionHeader} from '@/components/patterns/collection-header';
import {libraryHref} from '@/lib/route/library';
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
  const supported=['google_calendar','google_drive_folder','google_drive','google_sheet','microsoft_calendar','microsoft_drive_folder','microsoft_drive','microsoft_workbook'].includes(resource.resourceType);
  return <>
    <CollectionHeader title={resource.displayName} crumbs={[{label:'Sources',href:libraryHref(organizationId,'sources')}]}/>
    <p className="mt-4 text-sm text-muted">{resource.resourceType.replaceAll('_',' ')} · {resource.status.replaceAll('_',' ')}</p>
    <section className="mt-6"><h2 className="font-medium">Synchronization</h2>
      <p className="mt-1 text-sm">{sync?`${sync.enabled?'Enabled':'Disabled'} · ${sync.state}`:'Not enabled'}</p>
      {sync?.last_success_at?<p className="text-sm text-muted">Last completed: {new Date(sync.last_success_at).toISOString()}</p>:null}
      {sync?.last_error?<p role="alert" className="mt-2 text-sm">{sync.last_error}</p>:null}
      <p className="mt-2 text-sm text-muted">Files synchronize metadata. Calendars synchronize events. Worksheets reconcile the selected rows. Data remains in this organization’s Library.</p>
      {supported&&resource.status==='active'&&organization.capabilities.includes('integration.manage')?<ResourceSyncControl organizationId={organizationId} resourceId={resourceId} type={resource.resourceType} parameters={(sync?.parameters??{}) as Record<string,unknown>} enabled={sync?.enabled??false}/>:null}
    </section>
    <section className="mt-8"><h2 className="font-medium">Synchronized records</h2><p className="text-sm text-muted">Showing up to 100 records you have permission to read.</p>
      {records.length?<ul className="mt-3 divide-y divide-border">{records.map(record=><li key={record.external_id} className="py-1"><SourceRecordPreview record={record}/></li>)}</ul>:<p className="mt-3 text-sm text-muted">No synchronized records are available.</p>}
    </section>
  </>;
}
