'use server';
import { syncLibraryResource } from '@/app/organizations/[organizationId]/settings/connections/library-actions';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

import { redirect } from 'next/navigation';
import { CONTACT_LIFECYCLES, type ContactLifecycle } from '@/lib/domain/customers/classification';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { uploadImportFile, attachLibraryFileForImport, getResourceSync } from '@/lib/domain/integrations/resources';
import {
  createMapping,
  prepareImportFields,
  type MappingField,
  type MappingFieldTransform,
  type MappingTarget,
} from '@/lib/domain/integrations/mappings';
import { beginImportRun, requireImportPipeline, resumeImportStaging } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { libraryImportHref, libraryNewImportHref } from '@/lib/route/library';

export type UploadState = { error: string | null };

export async function uploadSourceAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  let resourceId: string;
  try {
    await requireImportPipeline(db);
    const uploaded = await uploadImportFile(db, { files: supabaseFileStore(db, BUCKET), organizationId, file });
    resourceId = uploaded.resourceId;
    await prepareImportFields(db, organizationId, uploaded.parsed.headers);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  redirect(libraryNewImportHref(organizationId, resourceId));
}

function parseTarget(value: string): MappingTarget {
  if (value.startsWith('core:')) {
    return { kind: 'core', field: value.slice(5) as 'name' | 'email' | 'phone' | 'lifecycle' | 'lead_temperature' | 'contact_type' | 'company_contact_id' | 'affiliation_title' };
  }
  if (value.startsWith('custom:')) {
    return { kind: 'custom', key: value.slice(7) };
  }
  if (value.startsWith('location:') && ['address', 'city', 'province'].includes(value.slice(9))) {
    return { kind: 'location', field: value.slice(9) as 'address' | 'city' | 'province' };
  }
  return { kind: 'ignore' };
}

export async function createMappingAndStageAction(formData: FormData): Promise<void> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const resourceId = String(formData.get('resourceId') ?? '');
  const headers = formData.getAll('header').map(String);

  const fields: MappingField[] = headers.map((header, index) => ({
    sourceColumn: header,
    target: parseTarget(String(formData.get(`target_${index}`) ?? 'ignore')),
    transform: (String(formData.get(`transform_${index}`) ?? 'none') as MappingFieldTransform),
  }));

  const fixedType=String(formData.get('contactType') ?? '');
  if(['person','company'].includes(fixedType)){
    for(const field of fields)if(field.target.kind==='core' && field.target.field==='contact_type')field.target={kind:'ignore'};
    fields.push({sourceColumn:'__fixed_contact_type',fixedValue:fixedType,target:{kind:'core',field:'contact_type'},transform:'none'});
  }
  // A source-wide lifecycle applies only to contacts this import creates; a valid lifecycle column
  // still wins per row, and existing contacts keep theirs. Absent both, new rows are Unclassified.
  const defaultLifecycle=String(formData.get('defaultLifecycle') ?? '');
  if(CONTACT_LIFECYCLES.includes(defaultLifecycle as ContactLifecycle))fields.push({sourceColumn:'__default_lifecycle',fixedValue:defaultLifecycle,target:{kind:'core',field:'default_lifecycle'},transform:'none'});
  const backTo = libraryNewImportHref(organizationId, resourceId);

  let runId: string | undefined;
  try {
    const mappingId = await createMapping(db, {
      organizationId,
      resourceId,
      fields,
      dedupeKey: formData.get('dedupeKey') === 'email' ? 'email' : null,
    });

    const sync = await db.rpc('configure_crm_import_sync', { p_organization_id: organizationId, p_mapping_id: mappingId, p_enabled: formData.get('mode') === 'sync' });
    if (sync.error) throw new DomainError(sync.error.message, 'integrations.sync_configuration_failed');
    runId = await beginImportRun(db, { organizationId, mappingId });

    await resumeImportStaging(db, { organizationId, runId });
  } catch (error) {
    if (error instanceof DomainError) {
      if (runId) redirect(libraryImportHref(organizationId, runId, `?stageError=${encodeURIComponent(error.message)}`));
      redirect(`${backTo}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  redirect(libraryImportHref(organizationId, runId));
}

export async function selectLibraryFileAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  let resourceId: string;
  try { resourceId = await attachLibraryFileForImport(db, organizationId, String(formData.get('documentId') ?? '')); }
  catch (error) { if (error instanceof DomainError) redirect(`${libraryNewImportHref(organizationId)}?error=${encodeURIComponent(error.message)}`); throw error; }
  redirect(libraryNewImportHref(organizationId, resourceId));
}

/** Reuses the saved mapping and the same review/apply command as an initial import. */
export async function reviewCrmSyncAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  const mappingId = String(formData.get('mappingId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  let runId: string;
  try {
    const mapping = await db.from('integration_mappings').select('id').eq('organization_id', organizationId).eq('resource_id', resourceId).eq('id', mappingId).eq('sync_mode', 'sync').single();
    if (mapping.error) throw new DomainError('That synchronized mapping is unavailable.', 'integrations.mapping_missing');
    const state = await getResourceSync(db, organizationId, resourceId);
    if (!state?.enabled) throw new DomainError('Enable Library synchronization before refreshing CRM.', 'integrations.sync_incomplete');
    const refresh = new FormData();
    refresh.set('organizationId', organizationId); refresh.set('resourceId', resourceId); refresh.set('intent', 'enable');
    for (const [key, value] of Object.entries(state.parameters as Record<string, unknown>)) refresh.set(key, String(value));
    const result = await syncLibraryResource({error:null,message:null}, refresh);
    if (result.error) throw new DomainError(result.error, 'integrations.sync_failed');
    runId = await beginImportRun(db, { organizationId, mappingId });
    await resumeImportStaging(db, { organizationId, runId });
  } catch (error) { if (error instanceof DomainError) redirect(`${libraryNewImportHref(organizationId, resourceId)}&error=${encodeURIComponent(error.message)}`); throw error; }
  redirect(libraryImportHref(organizationId, runId));
}

export async function disableCrmSyncAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  const result = await db.rpc('configure_crm_import_sync', { p_organization_id: organizationId, p_mapping_id: String(formData.get('mappingId') ?? ''), p_enabled: false });
  if (result.error) throw new DomainError(result.error.message, 'integrations.sync_configuration_failed');
  redirect(`/organizations/${organizationId}/library/sources/${String(formData.get('resourceId') ?? '')}`);
}
