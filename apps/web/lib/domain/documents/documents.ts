import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { contentMatchesFormat } from '@/lib/domain/files/content';
import { identifyFormat } from '@/lib/domain/files/formats';
import type { FileStore } from '@/lib/domain/files/storage-port';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** What a Library file can be linked to — a closed set, each a real column on `document_links` with a composite foreign key behind it (a polymorphic entity/id pair would make I18 unenforceable). */
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

/**
 * The formats a Library file may be. Each one has a signature `content.ts` can check, and each one's
 * MIME type is on the bucket's allowlist (migration 20261224000001). SVG is absent on purpose: it is
 * a document that can run script, and a file a person downloads should never be one.
 */
const ATTACHABLE_FORMAT_IDS: readonly string[] = [
  'csv', 'json', 'txt', 'md', 'xml', 'xlsx', 'xls', 'pdf', 'docx', 'rtf', 'pptx', 'png', 'jpg', 'webp',
];

export function isDocumentEntity(value: string): value is DocumentEntity {
  return (DOCUMENT_ENTITIES as readonly string[]).includes(value);
}

export async function listDocuments(
  db: Db,
  input: { organizationId: string; attachedTo: DocumentAttachment },
): Promise<StoredDocument[]> {
  // A record lists the files that reference it. The file itself is organization-owned and may be
  // referenced by other records too, so this reads the link and follows it to the file.
  const { data, error } = await db
    .from('document_links')
    .select('documents!inner(id, file_name, mime_type, size_bytes, created_at)')
    .eq('organization_id', input.organizationId)
    .eq(ATTACHMENT_COLUMN[input.attachedTo.entity], input.attachedTo.id)
    .order('created_at', { referencedTable: 'documents', ascending: false });

  if (error) {
    throw new DomainError(error.message, 'documents.list_failed');
  }

  return (data ?? []).map(({ documents: row }) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  }));
}

/**
 * Store a file and record it. Bytes first, then the row — the two can't be one transaction, so
 * between the two failure modes this picks the harmless one: unreferenced bytes with no row are
 * cleanable, while a row with no bytes is a broken link an operator sees. Runs under the caller's
 * own JWT — a service-role client would discard the storage policy that pins the path to the
 * caller's tenant.
 *
 * Before any byte is written, the file is checked twice: its name must be a format this library
 * accepts, and its first bytes must be that format. The browser's own type is not trusted for
 * either, and the stored type is the one the format implies.
 */
export async function uploadDocument(
  db: Db,
  input: {
    organizationId: string;
    /** Omitted for a Library file that no record uses yet. */
    attachedTo?: DocumentAttachment;
    file: File;
    /** Where the bytes go. The application builds this from its storage adapter, so this module depends only on the port. */
    files: FileStore;
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

  const format = identifyFormat(fileName);
  if (!format || !ATTACHABLE_FORMAT_IDS.includes(format.id)) {
    throw new DomainError('That kind of file cannot be attached here.', 'documents.unsupported');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesFormat(bytes, format)) {
    throw new DomainError(`That file is not really a ${format.label} file.`, 'documents.content_mismatch');
  }

  const store = input.files;

  // A random segment, not the document id — the id doesn't exist until the row is written, and the row is written second.
  const path = `${input.organizationId}/${globalThis.crypto.randomUUID()}/${safeKeySegment(fileName)}`;

  try {
    await store.put(path, file, format.mimeType);
  } catch (error) {
    throw new DomainError(error instanceof Error ? error.message : 'Upload failed.', 'documents.upload_failed');
  }

  const { data, error } = await db.rpc('create_document', {
    p_organization_id: input.organizationId,
    p_customer_id: columnValue(input.attachedTo, 'customer'),
    p_location_id: columnValue(input.attachedTo, 'location'),
    p_asset_id: columnValue(input.attachedTo, 'asset'),
    p_work_item_id: columnValue(input.attachedTo, 'work_item'),
    p_storage_path: path,
    p_file_name: fileName,
    p_mime_type: format.mimeType,
    p_size_bytes: file.size,
    p_content_sha256: await sha256Hex(bytes),
  });

  if (error) {
    // Compensating delete, best effort. The bucket lets the uploader remove an object no row points at, so this is the only caller that can remove it.
    await store.remove([path]);

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
  input: { documentId: string; files: FileStore },
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

  try {
    const url = await input.files.sign(row.storage_path, SIGNED_URL_TTL_SECONDS, row.file_name);
    return { url, fileName: row.file_name };
  } catch (error) {
    throw new DomainError(error instanceof Error ? error.message : 'Could not sign that URL.', 'documents.sign_failed');
  }
}

/** Returns `string`, not `string | null` — `supabase gen types` emits every function argument as non-null even when the parameter accepts null (D15). The cast lives here once instead of at four call sites. */
function columnValue(attachment: DocumentAttachment | undefined, entity: DocumentEntity): string {
  return (attachment?.entity === entity ? attachment.id : null) as string;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Not traversal defence (the tenant prefix handles that) — just keeps keys predictable and stops a `/` in a name from splitting into two path segments. */
function safeKeySegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'file';
}
