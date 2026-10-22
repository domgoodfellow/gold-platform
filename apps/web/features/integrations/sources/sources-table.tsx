import { ButtonLink } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import Link from 'next/link';
import type { IntegrationResource } from '@/lib/domain/integrations/resources';
import { libraryNewImportHref, librarySourceHref } from '@/lib/route/library';

/**
 * Every Resource this business has selected, across every Connection, and every file it has uploaded — the distinction from
 * Imports staying exactly what it was: a Resource is a reachable thing (a sheet, a folder, a
 * mailbox), not automatically imported data. What was actually brought in lives on the Imports
 * view instead.
 */
export function SourcesTable({
  organizationId,
  resources,
  connectionLabel,
  mayImport = false,
}: {
  organizationId: string;
  resources: IntegrationResource[];
  connectionLabel: Map<string, string>;
  mayImport?: boolean;
}) {
  return (
    <DataTable
      rows={resources}
      rowKey={(resource) => resource.id}
      empty="No data sources yet. Connect an app or upload a file to add one."
      columns={[
        { key: 'name', header: 'Resource', emphasis: 'primary', cell: (r) => <Link className="underline underline-offset-4" href={librarySourceHref(organizationId, r.id)}>{r.displayName}</Link> },
        { key: 'type', header: 'Type', cell: (r) => r.resourceType.replace(/_/g, ' ') },
        { key: 'connection', header: 'From', cell: (r) => (r.connectionId ? (connectionLabel.get(r.connectionId) ?? '—') : 'Uploaded file') },
        {
          key: 'status',
          header: 'Status',
          cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge>,
        },
        {
          key: 'actions',
          header: 'Import',
          cell: (r) => mayImport && ['file_upload','google_sheet','microsoft_workbook'].includes(r.resourceType) ? (
            <ButtonLink href={libraryNewImportHref(organizationId, r.id)} tone="text" size="small">
              Import →
            </ButtonLink>
          ) : null,
        },
      ]}
    />
  );
}
