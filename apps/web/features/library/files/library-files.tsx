import { selectLibraryFileAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { CollectionToolbar, type ActiveFilter } from '@/components/patterns/collection-toolbar';
import { Button, ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { DocumentUploadDialog } from '@/features/documents/upload-dialog';
import { LibraryNav } from '@/features/library/library-nav';
import {
  FILE_FAMILIES,
  FILE_PAGE_SIZE,
  fileFamilyLabel,
  formatFileSize,
  listLibraryFiles,
  readLibraryFile,
  readLibrarySummary,
  type FileUse,
  type LibraryFileDetail,
  type LibraryFileRow,
  isLibraryFileId,
  libraryFileFilter,
} from '@/lib/domain/documents/library-files';
import type { Db } from '@/lib/db/types';
import { libraryHref } from '@/lib/route/library';
import { SelectField } from '@/components/controls/select-field';

const USAGE_LABELS = {
  any: 'Any record',
  unused: 'Not used by any record',
  linked: 'Used by a record',
} as const;

const SORT_LABELS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name',
  largest: 'Largest first',
} as const;

const USE_PATH: Record<FileUse['kind'], string> = {
  customer: 'customers',
  location: 'locations',
  asset: 'assets',
  work_item: 'work',
};

/**
 * The Files collection: Library's files as a collection, not an upload form. The header's leading
 * region is Library's section tabs; its trailing region offers Upload, a focused dialog using the same
 * file control and server action records use. What the Library holds heads the results. Search, type, use and sort are the shared
 * collection toolbar. Filters, sort, page and the selected file all live in the URL, so a view can
 * be bookmarked and refreshed, and the selected file's details open without script. A Library with
 * no files shows one empty state instead of controls for an empty collection.
 */
export async function LibraryFilesCollection({
  db,
  organizationId,
  timezone,
  capabilities,
  query,
  upload,
}: {
  db: Db;
  organizationId: string;
  timezone: string;
  capabilities: readonly string[];
  query: Record<string, string | string[] | undefined>;
  upload: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
}) {
  const filter = libraryFileFilter(query);
  const selectedId = isLibraryFileId(query.file as string | undefined) ? (query.file as string) : null;
  const base = `/organizations/${organizationId}/library/files`;
  const mayUpload = capabilities.includes('document.create');

  const [{ rows, total }, summary, detail] = await Promise.all([
    listLibraryFiles(db, { organizationId, filter }),
    readLibrarySummary(db, { organizationId }),
    selectedId ? readLibraryFile(db, { organizationId, fileId: selectedId }) : Promise.resolve(null),
  ]);

  const hrefWith = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string' && value !== '' && !(key in changes)) params.set(key, value);
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value !== null && value !== '') params.set(key, value);
    }
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };
  // Removing one criterion keeps the others and starts again from the first page, with nothing selected.
  const without = (key: string) => hrefWith({ [key]: null, page: null, file: null });

  const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone });
  const page = filter.page;
  const active: ActiveFilter[] = [
    ...(filter.search ? [{ key: 'q', label: `Search: ${filter.search}`, removeHref: without('q') }] : []),
    ...(filter.family ? [{ key: 'family', label: `Type: ${FILE_FAMILIES[filter.family].label}`, removeHref: without('family') }] : []),
    ...(filter.usage !== 'any' ? [{ key: 'usage', label: USAGE_LABELS[filter.usage], removeHref: without('usage') }] : []),
  ];
  const changed = active.length > 0 || filter.sort !== 'newest';

  return (
    <AppPage>
      <CollectionHeader
        title="Files"
        crumbs={[{ label: 'Library', href: libraryHref(organizationId, 'files') }]}
        meta={<LibraryNav organizationId={organizationId} active="files" />}
        actions={mayUpload ? <DocumentUploadDialog action={upload} hiddenFields={{ organizationId }} /> : undefined}
      />

      {summary.fileCount === 0 ? (
        <EmptyState title="No files in Library yet" description={mayUpload ? undefined : 'Adding files needs a role that can add documents.'} />
      ) : <>
        <CollectionToolbar
          action={base}
          viewId="library-files"
          search={{ name: 'q', value: filter.search, label: 'Search files', placeholder: 'File name' }}
          filterCount={active.filter((item) => item.key !== 'q').length}
          filters={<>
            <label className="flex flex-col gap-1 text-sm">Type<SelectField name="family" aria-label="Filter by type" defaultValue={filter.family ?? ''} options={[{ value: '', label: 'All types' }, ...(Object.keys(FILE_FAMILIES) as (keyof typeof FILE_FAMILIES)[]).map((key) => ({ value: key, label: FILE_FAMILIES[key].label }))]} /></label>
            <label className="flex flex-col gap-1 text-sm">Used by<SelectField name="usage" aria-label="Filter by use" defaultValue={filter.usage} options={(Object.keys(USAGE_LABELS) as (keyof typeof USAGE_LABELS)[]).map((key) => ({ value: key, label: USAGE_LABELS[key] }))} /></label>
          </>}
          sort={<SelectField name="sort" aria-label="Sort files" defaultValue={filter.sort} className="w-full md:w-44" options={(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((key) => ({ value: key, label: SORT_LABELS[key] }))} />}
          active={active}
          resetHref={changed ? base : undefined}
        />

        <div className={detail || selectedId ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start' : undefined}>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm text-muted">
              {summary.fileCount} {summary.fileCount === 1 ? 'file' : 'files'} · {formatFileSize(summary.totalBytes)}
              {summary.unusedCount > 0 ? ` · ${summary.unusedCount} not used by any record` : ''}
            </p>
            <FileTable
              rows={rows}
              selectedId={detail?.id ?? null}
              emptyText="No files match these filters."
              hrefFor={(id) => hrefWith({ file: id })}
              dateFormat={dateFormat}
            />
            {total > FILE_PAGE_SIZE ? (
              <nav aria-label="Pagination" className="mt-2 flex items-center justify-between gap-3 text-sm">
                {page > 1 ? <ButtonLink href={hrefWith({ page: String(page - 1) })}>Previous</ButtonLink> : <span />}
                <span>Page {page} · {total} {total === 1 ? 'file' : 'files'}</span>
                {page * FILE_PAGE_SIZE < total ? <ButtonLink href={hrefWith({ page: String(page + 1) })}>Next</ButtonLink> : <span />}
              </nav>
            ) : null}
          </div>

          {selectedId ? (
            <aside className="order-first min-w-0 lg:order-none" aria-label="Selected file">
              {detail ? (
                <FileDetail
                  organizationId={organizationId}
                  detail={detail}
                  mayImport={capabilities.includes('integration.manage')}
                  dateFormat={dateFormat}
                  closeHref={hrefWith({ file: null })}
                />
              ) : (
                <Hint>That file is not available. It may have been removed, or it belongs to someone else.</Hint>
              )}
            </aside>
          ) : null}
        </div>
      </>}
    </AppPage>
  );
}

function FileTable({
  rows,
  selectedId,
  emptyText,
  hrefFor,
  dateFormat,
}: {
  rows: LibraryFileRow[];
  selectedId: string | null;
  emptyText: string;
  hrefFor: (id: string) => string;
  dateFormat: Intl.DateTimeFormat;
}) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={emptyText}
      columns={[
        {
          key: 'name',
          header: 'Name',
          emphasis: 'primary',
          cell: (row) => (
            <a
              href={hrefFor(row.id)}
              aria-current={row.id === selectedId ? 'true' : undefined}
              className={row.id === selectedId ? 'font-medium underline underline-offset-4' : 'underline underline-offset-4'}
            >
              {row.fileName}
            </a>
          ),
        },
        { key: 'type', header: 'Type', cell: (row) => fileFamilyLabel(row.mimeType) },
        { key: 'size', header: 'Size', numeric: true, cell: (row) => formatFileSize(row.sizeBytes) },
        {
          key: 'used',
          header: 'Used by',
          cell: (row) => (row.linkCount === 0 ? 'Not used yet' : `${row.linkCount} ${row.linkCount === 1 ? 'record' : 'records'}`),
        },
        { key: 'added', header: 'Added', cell: (row) => dateFormat.format(new Date(row.createdAt)) },
      ]}
    />
  );
}

function FileDetail({
  organizationId,
  detail,
  dateFormat,
  closeHref,
  mayImport,
}: {
  organizationId: string;
  detail: LibraryFileDetail;
  dateFormat: Intl.DateTimeFormat;
  closeHref: string;
  mayImport: boolean;
}) {
  return (
    <Section aria-labelledby="file-detail-heading" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading id="file-detail-heading" className="break-all">{detail.fileName}</SectionHeading>
        <ButtonLink href={closeHref} tone="text" size="small">Close</ButtonLink>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Type</dt>
        <dd>{fileFamilyLabel(detail.mimeType)}</dd>
        <dt className="text-muted">Size</dt>
        <dd>{formatFileSize(detail.sizeBytes)}</dd>
        <dt className="text-muted">Added</dt>
        <dd>{dateFormat.format(new Date(detail.createdAt))}</dd>
        <dt className="text-muted">Checksum</dt>
        <dd>{detail.contentSha256 ? <code className="break-all text-xs">{detail.contentSha256}</code> : 'Not recorded'}</dd>
      </dl>

      <ButtonLink href={`/organizations/${organizationId}/documents/${detail.id}/download`} tone="primary" size="small" className="mt-4">
        Download
      </ButtonLink>

      {mayImport && (detail.mimeType === 'text/csv' || detail.fileName.toLowerCase().endsWith('.csv')) ? <form action={selectLibraryFileAction} className="mt-3">
        <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="documentId" value={detail.id} />
        <Button type="submit" tone="secondary">Import into CRM</Button>
      </form> : null}
      <h3 className="mt-6 text-sm font-medium">Used by</h3>
      {detail.uses.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Not used by any record yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {detail.uses.map((use) => (
            <li key={`${use.kind}-${use.id}`}>
              <a className="underline underline-offset-4" href={`/organizations/${organizationId}/${USE_PATH[use.kind]}/${use.id}`}>
                {use.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
