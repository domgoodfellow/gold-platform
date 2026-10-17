import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * The Library's view of its files: what a person can filter by, one page of rows, the totals above
 * the list, and the detail for one file. The filters are plain words so they can live in the URL.
 */

export const FILE_FAMILIES = {
  documents: {
    label: 'Documents',
    mimeTypes: ['application/pdf', 'application/rtf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  spreadsheets: {
    label: 'Spreadsheets',
    mimeTypes: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  presentations: {
    label: 'Presentations',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  images: { label: 'Images', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
  text: { label: 'Text and data', mimeTypes: ['text/plain', 'text/markdown', 'application/json', 'application/xml'] },
} as const;

export type FileFamily = keyof typeof FILE_FAMILIES;

export const FILE_USAGE = ['any', 'unused', 'linked'] as const;
export type FileUsage = (typeof FILE_USAGE)[number];

export const FILE_SORTS = ['newest', 'oldest', 'name', 'largest'] as const;
export type FileSort = (typeof FILE_SORTS)[number];

export const FILE_PAGE_SIZE = 25;

export type LibraryFileFilter = {
  search: string;
  family: FileFamily | null;
  usage: FileUsage;
  sort: FileSort;
  page: number;
};

export type LibraryFileRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  contentSha256: string | null;
  linkCount: number;
};

export type LibraryFileSummary = {
  fileCount: number;
  totalBytes: number;
  unusedCount: number;
};

export type FileUse = {
  kind: 'customer' | 'location' | 'asset' | 'work_item';
  id: string;
  label: string;
};

export type LibraryFileDetail = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  contentSha256: string | null;
  uses: FileUse[];
};

/** A file id as the address carries it. Anything else is not a file, so it is treated as absent rather than sent to the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLibraryFileId(value: string | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

function one<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (allowed as readonly string[]).includes(candidate ?? '') ? (candidate as T) : null;
}

/** Reads the URL's words into a filter. Anything unrecognized falls back to the default rather than refusing the page. */
export function libraryFileFilter(query: Record<string, string | string[] | undefined>): LibraryFileFilter {
  const search = (Array.isArray(query.q) ? query.q[0] : query.q) ?? '';
  const pageNumber = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  return {
    search: search.trim().slice(0, 120),
    family: one(query.family, Object.keys(FILE_FAMILIES) as FileFamily[]),
    usage: one(query.usage, FILE_USAGE) ?? 'any',
    sort: one(query.sort, FILE_SORTS) ?? 'newest',
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

export async function listLibraryFiles(
  db: Db,
  input: { organizationId: string; filter: LibraryFileFilter },
): Promise<{ rows: LibraryFileRow[]; total: number }> {
  const { filter } = input;
  const { data, error } = await db.rpc('library_file_page', {
    p_organization_id: input.organizationId,
    p_search: filter.search || undefined,
    p_mime_types: filter.family ? [...FILE_FAMILIES[filter.family].mimeTypes] : undefined,
    p_usage: filter.usage,
    p_sort: filter.sort,
    p_limit: FILE_PAGE_SIZE,
    p_offset: (filter.page - 1) * FILE_PAGE_SIZE,
  });
  if (error) throw new DomainError(error.message, 'library.files_list_failed');

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    contentSha256: row.content_sha256,
    linkCount: Number(row.link_count),
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export async function readLibrarySummary(db: Db, input: { organizationId: string }): Promise<LibraryFileSummary> {
  const { data, error } = await db.rpc('library_file_summary', { p_organization_id: input.organizationId });
  if (error) throw new DomainError(error.message, 'library.summary_failed');
  const row = data?.[0];
  return {
    fileCount: Number(row?.file_count ?? 0),
    totalBytes: Number(row?.total_bytes ?? 0),
    unusedCount: Number(row?.unused_count ?? 0),
  };
}

/**
 * One file and the records that use it. A file that is not visible (another organization's, or an
 * Agent file someone else owns) is reported as absent, the same as one that does not exist.
 */
export async function readLibraryFile(
  db: Db,
  input: { organizationId: string; fileId: string },
): Promise<LibraryFileDetail | null> {
  if (!isLibraryFileId(input.fileId)) return null;
  const { data: file, error } = await db
    .from('documents')
    .select('id, file_name, mime_type, size_bytes, created_at, content_sha256')
    .eq('organization_id', input.organizationId)
    .eq('id', input.fileId)
    .is('agent_user_id', null)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'library.file_read_failed');
  if (!file) return null;

  const { data: links, error: linkError } = await db
    .from('document_links')
    .select('customer_id, location_id, asset_id, work_item_id')
    .eq('organization_id', input.organizationId)
    .eq('document_id', input.fileId);
  if (linkError) throw new DomainError(linkError.message, 'library.file_read_failed');

  const ids = {
    customer: (links ?? []).map((link) => link.customer_id).filter((id): id is string => id !== null),
    location: (links ?? []).map((link) => link.location_id).filter((id): id is string => id !== null),
    asset: (links ?? []).map((link) => link.asset_id).filter((id): id is string => id !== null),
    work_item: (links ?? []).map((link) => link.work_item_id).filter((id): id is string => id !== null),
  };

  const [customers, locations, assets, workItems] = await Promise.all([
    ids.customer.length ? db.from('customers').select('id, name').in('id', ids.customer) : { data: [], error: null },
    ids.location.length ? db.from('locations').select('id, label').in('id', ids.location) : { data: [], error: null },
    ids.asset.length ? db.from('assets').select('id, name').in('id', ids.asset) : { data: [], error: null },
    ids.work_item.length ? db.from('work_items').select('id, title').in('id', ids.work_item) : { data: [], error: null },
  ]);
  for (const result of [customers, locations, assets, workItems]) {
    if (result.error) throw new DomainError(result.error.message, 'library.file_read_failed');
  }

  const uses: FileUse[] = [
    ...(customers.data ?? []).map((row) => ({ kind: 'customer' as const, id: row.id, label: row.name })),
    ...(locations.data ?? []).map((row) => ({ kind: 'location' as const, id: row.id, label: row.label })),
    ...(assets.data ?? []).map((row) => ({ kind: 'asset' as const, id: row.id, label: row.name })),
    ...(workItems.data ?? []).map((row) => ({ kind: 'work_item' as const, id: row.id, label: row.title })),
  ];

  return {
    id: file.id,
    fileName: file.file_name,
    mimeType: file.mime_type,
    sizeBytes: Number(file.size_bytes),
    createdAt: file.created_at,
    contentSha256: file.content_sha256,
    uses,
  };
}

/** Bytes as a person reads them. Decimal units, matching the storage plans, which are stated in decimal GB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
  return `${(bytes / (1000 * 1000 * 1000)).toFixed(2)} GB`;
}

/** The family a file's type belongs to, for the table's type column. Falls back to the raw type. */
export function fileFamilyLabel(mimeType: string): string {
  for (const family of Object.values(FILE_FAMILIES)) {
    if ((family.mimeTypes as readonly string[]).includes(mimeType)) return family.label;
  }
  return mimeType;
}
