import { FileSpreadsheet, FolderOpen, History, Table2, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { Card } from '@/components/surfaces/card';
import type { IntegrationResource } from '@/lib/domain/integrations/resources';
import type { LibraryFileRow } from '@/lib/domain/documents/library-files';
import { libraryHref, libraryNewImportHref, librarySourceHref } from '@/lib/route/library';
import { selectLibraryFileAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';
import { UploadSourceForm } from './upload-source-form';

const date = (value: string) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(new Date(value));

function Option({ icon: Icon, title, description, children, id }: { icon: typeof Upload; title: string; description: string; children: ReactNode; id: string }) {
  return <Card as="section" aria-labelledby={id}>
    <div className="flex items-start gap-3"><Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
      {/* ui-copy-allow: each source option's description is what a person chooses between */}
      <div className="min-w-0 flex-1"><h2 id={id} className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-sm text-muted">{description}</p><div className="mt-3">{children}</div></div>
    </div>
  </Card>;
}
function Rows({ children, label }: { children: ReactNode; label: string }) {
  return <ul aria-label={label} className="divide-y divide-border rounded-md border border-border">{children}</ul>;
}

/**
 * Step 1 of the Library contact import: every source this business can import from, with what is
 * known about each. All four lead into the same mapping step; nothing here imports by itself.
 */
export function ChooseImportSource({ organizationId, resources, files, connectionStatus }: {
  organizationId: string; resources: IntegrationResource[]; files: LibraryFileRow[]; connectionStatus: Map<string, string>;
}) {
  const uploads = resources.filter(resource => resource.status === 'active' && resource.resourceType === 'file_upload');
  const worksheets = resources.filter(resource => resource.status === 'active' && ['google_sheet', 'microsoft_workbook'].includes(resource.resourceType));
  return <div className="grid gap-4 lg:grid-cols-2">
    <Option id="source-upload" icon={Upload} title="Upload a CSV" description="Export contacts from another system as CSV. GildOps reads the header row and shows a mapping before anything is written.">
      <UploadSourceForm organizationId={organizationId} />
    </Option>
    <Option id="source-library" icon={FolderOpen} title="Choose a Library file" description="Use a CSV already stored in this business's Library.">
      {files.length ? <Rows label="Library CSV files">{files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0"><span className="block break-words font-medium">{file.fileName}</span><span className="text-xs text-muted">Added {date(file.createdAt)}</span></span>
        <form action={selectLibraryFileAction}><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="documentId" value={file.id} /><Button type="submit" tone="secondary" size="small">Use this file</Button></form>
      </li>)}</Rows> : <p className="text-sm text-muted">No CSV files in Library yet. <ButtonLink tone="text" href={libraryHref(organizationId, 'files')}>Open Library files</ButtonLink></p>}
    </Option>
    <Option id="source-saved" icon={History} title="Use a saved source" description="Import again from a CSV uploaded before. Its saved source identities let updates match the contacts it created.">
      {uploads.length ? <Rows label="Saved sources">{uploads.map(resource => <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0 break-words font-medium"><FileSpreadsheet aria-hidden className="mr-1.5 inline size-4 text-muted" />{resource.displayName}</span>
        <span className="flex gap-2"><ButtonLink tone="text" size="small" href={librarySourceHref(organizationId, resource.id)}>Source status</ButtonLink><ButtonLink tone="secondary" size="small" href={libraryNewImportHref(organizationId, resource.id)}>Use</ButtonLink></span>
      </li>)}</Rows> : <p className="text-sm text-muted">No saved sources yet. An uploaded CSV is saved here for next time.</p>}
    </Option>
    <Option id="source-worksheet" icon={Table2} title="Choose a connected worksheet" description="Read rows from a connected Google Sheets or Excel worksheet. Keep it synchronized to review later changes before they reach CRM.">
      {worksheets.length ? <Rows label="Connected worksheets">{worksheets.map(resource => {
        const status = resource.connectionId ? connectionStatus.get(resource.connectionId) ?? 'unavailable' : 'snapshot';
        return <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0"><span className="block break-words font-medium">{resource.displayName}</span><span className="text-xs text-muted">{resource.resourceType === 'google_sheet' ? 'Google Sheets' : 'Microsoft Excel'} · connection {status.replaceAll('_', ' ')}</span></span>
          <span className="flex gap-2"><ButtonLink tone="text" size="small" href={librarySourceHref(organizationId, resource.id)}>Source status</ButtonLink><ButtonLink tone="secondary" size="small" href={libraryNewImportHref(organizationId, resource.id)}>Use</ButtonLink></span>
        </li>;
      })}</Rows> : <p className="text-sm text-muted">No worksheet is connected. Worksheets are added from a Google Workspace or Microsoft 365 connection in Library sources.</p>}
    </Option>
  </div>;
}
