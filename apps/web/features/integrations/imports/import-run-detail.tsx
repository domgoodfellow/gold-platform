import { Button, ButtonLink } from '@/components/controls/button';
import { resumeImportStagingAction } from '@/app/organizations/[organizationId]/library/imports/[runId]/actions';
import { Hint } from '@/components/controls/inputs';
import { Card } from '@/components/surfaces/card';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { WidgetGrid, Widget } from '@/components/display/widget';
import type { ImportRun, StagingRow, StagingRowStatus } from '@/lib/domain/integrations/import-runs';
import { ApplyImportForm } from './apply-import-form';
import { libraryImportHref, librarySourceHref } from '@/lib/route/library';

const STATUS_LABEL: Record<StagingRowStatus, string> = {
  ready: 'Ready',
  duplicate: 'Possible duplicate',
  invalid: 'Rejected',
  ignored: 'Skipped',
  applied: 'Applied',
  failed: 'Failed',
};

const FILTERS: { key: StagingRowStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'duplicate', label: 'Possible duplicates' },
  { key: 'invalid', label: 'Rejected' },
  { key: 'applied', label: 'Applied' },
  { key: 'failed', label: 'Failed' },
];

/** What staging decided, counted from the staged rows themselves; nothing here is estimated. */
export function summarizeStaging(rows: StagingRow[]) {
  const ready = rows.filter(row => row.status === 'ready');
  const typeOf = (row: StagingRow) => String((row.normalized as { contact_type?: string }).contact_type ?? '');
  return {
    created: ready.filter(row => row.proposedAction === 'create').length,
    updated: ready.filter(row => row.proposedAction === 'update').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    skipped: rows.filter(row => row.status === 'invalid' || row.status === 'ignored').length,
    unclassified: ready.filter(row => row.proposedAction === 'create' && !['person', 'company'].includes(typeOf(row))).length,
  };
}

/**
 * One import run as the last three steps of the contact import: Review changes (what applying would
 * do), Apply (an explicit confirmation), and Results (what actually happened, from the run's own
 * counters). Conflicts with local edits are detected while applying and reported there as failures,
 * so they are never forecast here.
 */
export function ImportRunDetail({
  organizationId,
  runId,
  run,
  rows,
  summary,
  readyCount,
  status,
}: {
  organizationId: string;
  runId: string;
  run: ImportRun;
  rows: StagingRow[];
  summary: ReturnType<typeof summarizeStaging>;
  readyCount: number;
  status?: StagingRowStatus;
}) {
  const finished = run.status === 'completed' || run.status === 'completed_with_errors';
  return (
    <>
      {finished ? (
        <Card as="section" aria-labelledby="import-results">
          <h2 id="import-results" className="text-sm font-semibold">Results</h2>
          <WidgetGrid className="mt-3">
            <Widget title="Created" value={run.rowsCreated} />
            <Widget title="Updated" value={run.rowsUpdated} />
            <Widget title="Skipped" value={run.rowsSkipped} />
            <Widget title="Failed" value={run.rowsFailed} />
          </WidgetGrid>
          {run.rowsFailed ? <Hint className="mt-3 block">Failed rows include any where a contact was edited in GildOps after this source last changed it; those contacts were kept as they are.</Hint> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={`/organizations/${organizationId}/crm/contacts`} tone="primary">View contacts</ButtonLink>
            {run.rowsFailed ? <ButtonLink href={libraryImportHref(organizationId, runId, `?status=failed`)} tone="secondary">Review problems</ButtonLink> : null}
            {run.resourceId ? <ButtonLink href={librarySourceHref(organizationId, run.resourceId)} tone="text">Open saved source</ButtonLink> : null}
          </div>
        </Card>
      ) : run.status === 'pending' || run.status === 'running' ? (
        <Card as="section" aria-labelledby="import-review">
          <h2 id="import-review" className="text-sm font-semibold">Review changes</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Staged changes">
            {[['New contacts', summary.created], ['Updates to existing contacts', summary.updated], ['Possible duplicates (not applied)', summary.duplicates], ['Skipped or rejected', summary.skipped]].map(([label, value]) =>
              <div key={label} className="rounded-md bg-secondary px-3 py-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
          {summary.unclassified ? <p role="status" className="mt-3 text-sm">{summary.unclassified} new contact{summary.unclassified === 1 ? '' : 's'} will be saved as Unspecified / Needs classification because no contact type was mapped.</p> : null}
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Apply</p>
            <Hint>Nothing has been written to Contacts yet.</Hint>
            <ApplyImportForm organizationId={organizationId} runId={runId} readyCount={readyCount} />
            {run.status === 'pending' ? (
              <form action={resumeImportStagingAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="runId" value={runId} />
                <Button type="submit" tone="secondary">Resume staging</Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : (
        <Hint className="mt-6">This import is still running.</Hint>
      )}

      <section aria-label="Staged rows" className="mt-8">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => (
            <ButtonLink
              key={filter.key}
              href={
                filter.key === 'all'
                  ? libraryImportHref(organizationId, runId)
                  : libraryImportHref(organizationId, runId, `?status=${filter.key}`)
              }
              tone={status === filter.key || (filter.key === 'all' && !status) ? 'primary' : 'secondary'}
              size="small"
            >
              {filter.label}
            </ButtonLink>
          ))}
        </div>

        <div className="mt-4">
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            empty="No rows match this filter."
            columns={[
              { key: 'name', header: 'Name', emphasis: 'primary', cell: (row) => (row.normalized as { name?: string }).name ?? '—' },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <Badge tone={row.status === 'ready' || row.status === 'applied' ? 'success' : 'neutral'}>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                ),
              },
              { key: 'action', header: 'Action', visibility: 'card-only', cell: (row) => row.proposedAction === 'create' ? 'New contact' : row.proposedAction === 'update' ? 'Update existing contact' : 'Skip' },
              {
                key: 'problem',
                header: 'Problem',
                visibility: 'card-only',
                cell: (row) =>
                  row.validationErrors.length > 0 ? <span className="text-danger">{row.validationErrors.join(' ')}</span> : '—',
              },
              // The stable source key is long and machine-made; its end is enough to tell rows apart, and the whole key stays available.
              { key: 'key', header: 'Source row', visibility: 'card-only', cell: (row) => <span title={row.sourceRecordKey} className="font-mono text-xs text-muted">…{row.sourceRecordKey.slice(-8)}</span> },
            ]}
          />
        </div>
      </section>
    </>
  );
}
