import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import type { ImportRun } from '@/lib/domain/integrations/import-runs';
import { libraryImportHref } from '@/lib/route/library';

const STATUS_TONE: Record<string, 'success' | 'neutral'> = {
  completed: 'success',
  pending: 'neutral',
  running: 'neutral',
  completed_with_errors: 'neutral',
  failed: 'neutral',
};

/** Every import this business has run, newest first — the collection the Imports view owns. */
export function ImportRunsTable({
  organizationId,
  runs,
  resourceName,
  connectorLabel,
}: {
  organizationId: string;
  runs: ImportRun[];
  resourceName: Map<string, string>;
  connectorLabel: Map<string, string>;
}) {
  return (
    <DataTable
      rows={runs}
      rowKey={(run) => run.id}
      empty="No imports yet."
      columns={[
        {
          key: 'source',
          header: 'Source',
          emphasis: 'primary',
          cell: (run) => (
            <a href={libraryImportHref(organizationId, run.id)} className="underline-offset-4 hover:underline">
              {(run.resourceId && resourceName.get(run.resourceId)) ?? connectorLabel.get(run.connectorKey) ?? run.connectorKey}
            </a>
          ),
        },
        { key: 'started', header: 'Started', cell: (run) => new Date(run.startedAt).toLocaleString('en-GB') },
        {
          key: 'status',
          header: 'Status',
          cell: (run) => <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status.replace(/_/g, ' ')}</Badge>,
        },
        { key: 'created', header: 'Created', numeric: true, cell: (run) => run.rowsCreated },
        { key: 'updated', header: 'Updated', numeric: true, cell: (run) => run.rowsUpdated },
        { key: 'skipped', header: 'Skipped', numeric: true, emphasis: 'secondary', cell: (run) => run.rowsSkipped },
        { key: 'failed', header: 'Failed', numeric: true, emphasis: 'secondary', cell: (run) => run.rowsFailed },
      ]}
    />
  );
}
