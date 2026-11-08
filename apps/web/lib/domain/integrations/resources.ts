import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { BUCKET as DOCUMENTS_BUCKET } from '@/lib/domain/documents/documents';
import { contentMatchesFormat } from '@/lib/domain/files/content';
import type { FileStore } from '@/lib/domain/files/storage-port';
import { checkFileIntake, storageKeySegment } from '@/lib/domain/files/intake';
import { parseCsv, type ParsedCsv } from '@/lib/domain/files/parsers/csv';

export type IntegrationResource = {
  id: string;
  /** Null for an uploaded file: it belongs to no external system. */
  connectionId: string | null;
  resourceType: string;
  displayName: string;
  externalId: string | null;
  status: 'active' | 'needs_attention' | 'disabled';
  createdAt: string;
  /** What the provider reported about it, written only by the API's discovery. Descriptive, never a credential. */
  metadata: unknown;
};

const DISPLAY_NAME_MAX = 200;

export async function listResources(
  db: Db,
  input: { organizationId: string; connectionId?: string },
): Promise<IntegrationResource[]> {
  let query = db
    .from('integration_resources')
    .select('id, connection_id, resource_type, display_name, external_id, status, created_at, metadata')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (input.connectionId) {
    query = query.eq('connection_id', input.connectionId);
  }

  const { data, error } = await query;

  if (error) {
    throw fromDatabaseError(error, 'integrations.resources_list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    connectionId: row.connection_id,
    resourceType: row.resource_type,
    displayName: row.display_name,
    externalId: row.external_id,
    status: row.status as IntegrationResource['status'],
    createdAt: row.created_at,
    metadata: row.metadata,
  }));
}

/** Tenant and workspace permission checks remain in RLS; cursors and leases are never selected. */
export async function getResourceSync(db: Db, organizationId: string, resourceId: string) {
  const {data,error}=await db.from('integration_resource_syncs')
    .select('enabled,parameters,state,last_success_at,last_error,next_run_at')
    .eq('organization_id',organizationId).eq('resource_id',resourceId).maybeSingle();
  if(error)throw fromDatabaseError(error, 'integrations.sync_read_failed');
  return data;
}

export async function listResourceRecords(db: Db, organizationId: string, resourceId: string) {
  const {data,error}=await db.from('integration_resource_records')
    .select('external_id,display_name,metadata,source_updated_at').eq('organization_id',organizationId)
    .eq('resource_id',resourceId).eq('deleted',false).order('display_name').limit(100);
  if(error)throw fromDatabaseError(error, 'integrations.records_read_failed');
  return data??[];
}

/**
 * A file handed to the CRM import, stored and read once. It is an artifact, not a connection: the
 * resource has no `connection_id`, and what may come in is `files/`'s question — the format
 * registry says which formats the `crm_import` consumer reads, and policy says what this business
 * admits. Stored under the same `documents` bucket the rest of the platform already uses — same
 * tenant-prefixed path, same storage policy — just never given a row in the `documents` table,
 * since an import file is not attached to one of that table's owning entities. `integration_resources`
 * is its owner instead.
 */
export async function uploadImportFile(
  db: Db,
  input: { organizationId: string; file: File; files: FileStore },
): Promise<{ resourceId: string; parsed: ParsedCsv }> {
  await requireActor(db);

  const { file } = input;

  const checked = checkFileIntake(file, { consumer: 'crm_import' });
  if (!checked.ok) {
    throw new DomainError(
      checked.reason === 'unsupported' ? 'CRM import reads CSV files only.' : checked.message,
      `integrations.file_${checked.reason}`,
    );
  }
  const { artifact } = checked;

  const parsed = parseCsv(await file.text());

  if (!contentMatchesFormat(new Uint8Array(await file.arrayBuffer()), artifact.format)) {
    throw new DomainError('That file is not really a CSV file.', 'integrations.content_mismatch');
  }

  const path = `${input.organizationId}/imports/${randomUUID()}/${storageKeySegment(artifact.name, 'file.csv')}`;
  const store = input.files;

  try {
    await store.put(path, file, artifact.mimeType);
  } catch (error) {
    throw new DomainError(error instanceof Error ? error.message : 'Upload failed.', 'integrations.upload_failed');
  }

  const displayName = artifact.name.slice(0, DISPLAY_NAME_MAX) || 'Uploaded file';

  const { data, error } = await db.rpc('record_integration_resource', {
    p_organization_id: input.organizationId,
    // A file belongs to no external system; the table's own check is what allows the absence.
    p_connection_id: null as unknown as string,
    p_resource_type: 'file_upload',
    p_display_name: displayName,
    p_external_id: null as unknown as string,
    p_storage_path: path,
    p_metadata: { format: artifact.format.id, headers: parsed.headers, totalRows: parsed.totalRows },
  });

  if (error) {
    await store.remove([path]);
    if (error.code === '42501') {
      throw new DomainError('You cannot add data sources here.', 'integrations.forbidden');
    }
    throw fromDatabaseError(error, 'integrations.resource_create_failed');
  }

  return { resourceId: data, parsed };
}

/** The stored bytes' own path, for a resource this platform holds a file for — null for every API-reached resource, which has none. */
export async function getResourceStoragePath(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<string | null> {
  const { data, error } = await db
    .from('integration_resources')
    .select('storage_path')
    .eq('organization_id', input.organizationId)
    .eq('id', input.resourceId)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'integrations.resource_get_failed');
  }
  return data?.storage_path ?? null;
}

/**
 * Re-reads and re-parses an imported file's stored bytes — the mapping step's preview and the
 * staging step's full read both call this rather than each downloading and parsing on their
 * own. Null for a resource with no stored file, or one whose file has gone missing.
 */
export async function downloadImportFile(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<ParsedCsv | null> {
  const path = await getResourceStoragePath(db, input);
  if (!path) {
    const {data:resource,error:resourceError}=await db.from('integration_resources').select('resource_type,status')
      .eq('organization_id',input.organizationId).eq('id',input.resourceId).maybeSingle();
    if(resourceError)throw fromDatabaseError(resourceError, 'integrations.resource_get_failed');
    if(!resource||resource.status!=='active'||!['google_sheet','microsoft_workbook'].includes(resource.resource_type))return null;
    const sync=await getResourceSync(db,input.organizationId,input.resourceId);
    if(!sync?.last_success_at||sync.state!=='idle')throw new DomainError('Complete synchronization before mapping this worksheet.','integrations.sync_incomplete');
    const {data,error}=await db.from('integration_resource_records').select('external_id,metadata').eq('organization_id',input.organizationId)
      .eq('resource_id',input.resourceId).eq('deleted',false).order('external_id').limit(501);
    if(error)throw fromDatabaseError(error, 'integrations.rows_read_failed');
    if(!data?.length)return null;
    const values=data.map(record=>record.metadata as {headers:string[];values:unknown[]});
    const headers=values[0].headers;
    if(!headers?.length||values.some(record=>JSON.stringify(record.headers)!==JSON.stringify(headers)))throw new DomainError('Worksheet columns changed. Synchronize again before mapping.','integrations.headers_changed');
    const rows=values.map((record,rowIndex)=>({...Object.fromEntries(headers.map((header,index)=>[header,String(record.values[index]??'')])), __source_record_id:data[rowIndex].external_id}));
    return {headers,rows,sample:rows.slice(0,5),totalRows:rows.length,truncated:rows.length>500};
  }

  const { data: blob, error } = await db.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !blob) return null;

  return parseCsv(await blob.text());
}

/** Register an existing Library CSV as an import source without copying its bytes. */
export async function attachLibraryFileForImport(db: Db, organizationId: string, documentId: string): Promise<string> {
  await requireActor(db);
  const { data: document, error } = await db.from('documents').select('id,file_name,mime_type,storage_path').eq('organization_id', organizationId).eq('id', documentId).maybeSingle();
  if (error || !document) throw new DomainError('That Library file is unavailable.', 'integrations.file_missing');
  const { data: existing } = await db.from('integration_resources').select('id').eq('organization_id', organizationId).eq('resource_type', 'file_upload').eq('storage_path', document.storage_path).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data: blob, error: downloadError } = await db.storage.from(DOCUMENTS_BUCKET).download(document.storage_path);
  if (downloadError || !blob) throw new DomainError('The selected file could not be read.', 'integrations.file_missing');
  const file = new File([blob], document.file_name, { type: document.mime_type });
  const checked = checkFileIntake(file, { consumer: 'crm_import' });
  if (!checked.ok) throw new DomainError('CRM intake currently reads CSV files.', 'integrations.file_unsupported');
  const parsed = parseCsv(await file.text());
  const result = await db.rpc('record_integration_resource', {
    p_organization_id: organizationId, p_connection_id: null as unknown as string,
    p_resource_type: 'file_upload', p_display_name: document.file_name.slice(0, DISPLAY_NAME_MAX),
    p_external_id: null as unknown as string, p_storage_path: document.storage_path,
    p_metadata: { format: checked.artifact.format.id, headers: parsed.headers, totalRows: parsed.totalRows, library_document_id: document.id },
  });
  if (result.error) throw fromDatabaseError(result.error, 'integrations.resource_create_failed');
  return result.data;
}
