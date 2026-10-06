import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { BUCKET as DOCUMENTS_BUCKET } from '@/lib/domain/documents/documents';
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
    throw new DomainError(error.message, 'integrations.resources_list_failed');
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
  input: { organizationId: string; file: File },
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

  const path = `${input.organizationId}/imports/${randomUUID()}/${storageKeySegment(artifact.name, 'file.csv')}`;

  const { error: uploadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: artifact.mimeType, upsert: false });

  if (uploadError) {
    throw new DomainError(uploadError.message, 'integrations.upload_failed');
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
    await db.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (error.code === '42501') {
      throw new DomainError('You cannot add data sources here.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.resource_create_failed');
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
    throw new DomainError(error.message, 'integrations.resource_get_failed');
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
  if (!path) return null;

  const { data: blob, error } = await db.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !blob) return null;

  return parseCsv(await blob.text());
}
