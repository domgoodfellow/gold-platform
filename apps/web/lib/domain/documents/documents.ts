import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a document can be attached to.
 *
 * Platform vocabulary, and deliberately a closed set: each entry is a real column on
 * `documents` with a composite foreign key behind it. A polymorphic
 * `(entity_type, entity_id)` pair would let this list be open, and would also make I18
 * unenforceable — see the migration.
 */
export const DOCUMENT_ENTITIES = ['customer', 'location', 'asset', 'work_item'] as const;

export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];

/** The one place the entity name maps to its column. */
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

/**
 * How long a download link lives.
 *
 * Short on purpose. constraints.md forbids serving a private file from a durable public URL;
 * a signed URL is only not-durable if its lifetime is measured in seconds. Long enough to
 * follow a click, not long enough to paste into a chat and still work tomorrow.
 */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Matches the bucket's own file_size_limit, which is the enforcement. This is the message. */
const MAX_BYTES = 25 * 1024 * 1024;

const FILE_NAME_MAX = 255;

export function isDocumentEntity(value: string): value is DocumentEntity {
  return (DOCUMENT_ENTITIES as readonly string[]).includes(value);
}

/**
 * The documents attached to one entity.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted these rows.
 */
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
 * Store a file and record who owns it.
 *
 * The order is bytes first, then the row, and it is deliberate. The two writes cannot be one
 * transaction — object storage is not Postgres — so one of the two failure modes has to be
 * chosen. Bytes with no row are unreferenced and unreachable: `documents` is the authority on
 * who owns them, so nothing can find them and they are cleanable. A row with no bytes is a
 * broken link an operator sees. The compensating delete below makes the first case rare, and
 * the choice makes it harmless when it happens anyway.
 *
 * The upload runs under the caller's own JWT. It has to: a service-role client would discard
 * the storage policy that pins the path to the caller's tenant, which is the only thing
 * making the prefix a boundary rather than a convention.
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

  // The stored key is sanitised and uniquified; `file_name` keeps what the person called it.
  // A random segment rather than the document id, because the id does not exist until the
  // row is written and the row is written second.
  const path = `${input.organizationId}/${randomUUID()}/${safeKeySegment(fileName)}`;

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
    // Compensating delete. Best effort: if it fails the bytes are orphaned, which is the
    // failure this ordering was chosen to make harmless.
    await db.storage.from(BUCKET).remove([path]);

    if (error.code === '42501') {
      throw new DomainError('You cannot add documents here.', 'documents.forbidden');
    }
    if (error.code === '23503') {
      throw new DomainError('No such record here to attach to.', 'documents.owner_not_found');
    }
    throw new DomainError(error.message, 'documents.create_failed');
  }

  return data;
}

/**
 * A short-lived URL for one document.
 *
 * The row is read first, through the caller's own client, and that read IS the permission
 * check: RLS returns nothing for a document in another tenant, so there is nothing to sign.
 * constraints.md requires the signed URL be minted *after* the same permission check the
 * rest of the operation gets, and reading the row under RLS is that check rather than a
 * separate one that could drift from it.
 */
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
    // Covers "no such document" and "not yours" without the caller being able to tell them
    // apart, because RLS produced the indistinguishability for free.
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

/**
 * The id if this is the attached entity, null otherwise.
 *
 * Returns `string` rather than `string | null` because `supabase gen types` emits every
 * function argument as non-null: Postgres records no nullability for parameters, so
 * `p_customer_id uuid` — which accepts null by design — is typed `string`
 * (constraints.md D15). The cast lives here once instead of at four call sites.
 */
function columnValue(attachment: DocumentAttachment, entity: DocumentEntity): string {
  return (attachment.entity === entity ? attachment.id : null) as string;
}

/**
 * Make a file name safe to use as one path segment.
 *
 * Storage keys are opaque strings rather than filesystem paths, so this is not traversal
 * defence — the tenant prefix and its policy handle that. It keeps keys predictable and
 * stops a name containing `/` from silently becoming two segments, which would move the file
 * out of the folder the policy expects.
 */
function safeKeySegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'file';
}
