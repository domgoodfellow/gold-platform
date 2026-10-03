import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** What a document can be attached to — a closed set, each a real column with a composite foreign key behind it (a polymorphic entity/id pair would make I18 unenforceable). */
export const DOCUMENT_ENTITIES = ['customer', 'location', 'asset', 'work_item'] as const;

export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];

const ATTACHMENT_COLUMN: Record<DocumentEntity, string> = {
  customer: 'customer_id',
  location: 'location_id',
  asset: 'asset_id',
  work_item: 'work_item_id',
};

export type DocumentAttachment = {
  entity: DocumentEntity;
  id: string;
};

export type StoredDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export const BUCKET = 'documents';

/** Short on purpose — a signed URL is only not-durable if its lifetime is seconds, long enough to follow a click and not to paste into a chat. */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Matches the bucket's own file_size_limit, which is the enforcement — this is just the message. */
const MAX_BYTES = 25 * 1024 * 1024;

const FILE_NAME_MAX = 255;

export function isDocumentEntity(value: string): value is DocumentEntity {
  return (DOCUMENT_ENTITIES as readonly string[]).includes(value);
}

export async function listDocuments(
  db: Db,
  input: { organizationId: string; attachedTo: DocumentAttachment },
): Promise<StoredDocument[]> {
  const { data, error } = await db
    .from('documents')
    .select('id, file_name, mime_type, size_bytes, created_at')
    .eq('organization_id', input.organizationId)
    .eq(ATTACHMENT_COLUMN[input.attachedTo.entity], input.attachedTo.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'documents.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  }));
}

/**
 * Store a file and record who owns it. Bytes first, then the row — the two can't be one
 * transaction, so between the two failure modes this picks the harmless one: unreferenced bytes
 * with no row are cleanable, while a row with no bytes is a broken link an operator sees. Runs
 * under the caller's own JWT — a service-role client would discard the storage policy that pins
 * the path to the caller's tenant.
 */
export async function uploadDocument(
  db: Db,
  input: {
    organizationId: string;
    attachedTo: DocumentAttachment;
    file: File;
  },
): Promise<string> {
  await requireActor(db);

  const { file } = input;

  if (file.size === 0) {
    throw new DomainError('That file is empty.', 'documents.empty');
  }
  if (file.size > MAX_BYTES) {
    throw new DomainError(
      `That file is larger than ${Math.floor(MAX_BYTES / (1024 * 1024))} MB.`,
      'documents.too_large',
    );
  }

  const fileName = file.name.trim().slice(0, FILE_NAME_MAX);
  if (fileName.length === 0) {
    throw new DomainError('That file has no name.', 'documents.name_required');
  }

  // A random segment, not the document id — the id doesn't exist until the row is written, and the row is written second.
  const path = `${input.organizationId}/${globalThis.crypto.randomUUID()}/${safeKeySegment(fileName)}`;

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });

  if (uploadError) {
    throw new DomainError(uploadError.message, 'documents.upload_failed');
  }

  const { data, error } = await db.rpc('create_document', {
    p_organization_id: input.organizationId,
    p_customer_id: columnValue(input.attachedTo, 'customer'),
    p_location_id: columnValue(input.attachedTo, 'location'),
    p_asset_id: columnValue(input.attachedTo, 'asset'),
    p_work_item_id: columnValue(input.attachedTo, 'work_item'),
    p_storage_path: path,
    p_file_name: fileName,
    p_mime_type: file.type || 'application/octet-stream',
    p_size_bytes: file.size,
  });

  if (error) {
    // Compensating delete, best effort — if it fails the bytes are orphaned, which this ordering made harmless.
    await db.storage.from(BUCKET).remove([path]);

    if (error.code === '42501') {
      throw new DomainError('You cannot add documents here.', 'documents.forbidden');
    }
    if (error.code === '23503') {
      throw new DomainError('No such record here to attach to.', 'documents.owner_not_found');
    }
    // Distinguished by message, the same way `open_call` tells its own hard-limit refusal apart
    // from every other 23514 check violation — `create_document`'s own storage-allowance check
    // raises with this wording and no other 23514 here does.
    if (error.code === '23514' && error.message.includes('storage limit')) {
      throw new DomainError(error.message, 'documents.storage_limit_reached');
    }
    throw new DomainError(error.message, 'documents.create_failed');
  }

  return data;
}

/** The row read is the permission check — RLS returns nothing for a document in another tenant, so there's nothing to sign. */
export async function getDocumentUrl(
  db: Db,
  input: { documentId: string },
): Promise<{ url: string; fileName: string }> {
  const { data: row, error } = await db
    .from('documents')
    .select('storage_path, file_name')
    .eq('id', input.documentId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'documents.get_failed');
  }
  if (!row) {
    // Covers "no such document" and "not yours" indistinguishably, for free, via RLS.
    throw new DomainError('No such document here.', 'documents.not_found');
  }

  const { data: signed, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, { download: row.file_name });

  if (signError || !signed) {
    throw new DomainError(signError?.message ?? 'Could not sign that URL.', 'documents.sign_failed');
  }

  return { url: signed.signedUrl, fileName: row.file_name };
}

/** Returns `string`, not `string | null` — `supabase gen types` emits every function argument as non-null even when the parameter accepts null (D15). The cast lives here once instead of at four call sites. */
function columnValue(attachment: DocumentAttachment, entity: DocumentEntity): string {
  return (attachment.entity === entity ? attachment.id : null) as string;
}

/** Not traversal defence (the tenant prefix handles that) — just keeps keys predictable and stops a `/` in a name from splitting into two path segments. */
function safeKeySegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'file';
}
