import { Button, ButtonLink } from '@/components/controls/button';
import { resumeImportStagingAction } from '@/app/organizations/[organizationId]/library/imports/[runId]/actions';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { WidgetGrid, Widget } from '@/components/display/widget';
import type { ImportRun, StagingRow, StagingRowStatus } from '@/lib/domain/integrations/import-runs';
import { ApplyImportForm } from './apply-import-form';
import { libraryImportHref } from '@/lib/route/library';

const STATUS_LABEL: Record<StagingRowStatus, string> = {
  ready: 'Ready',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
  ignored: 'Ignored',
  applied: 'Applied',
  failed: 'Failed',
};

const FILTERS: { key: StagingRowStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'invalid', label: 'Invalid' },
  { key: 'applied', label: 'Applied' },
  { key: 'failed', label: 'Failed' },
];

/** One import run: its result or its review step, and the staging rows behind whichever filter is active. */
export function ImportRunDetail({
  organizationId,
  runId,
  run,
  rows,
  readyCount,
  status,
}: {
  organizationId: string;
  runId: string;
  run: ImportRun;
  rows: StagingRow[];
  readyCount: number;
  status?: StagingRowStatus;
}) {
  return (
    <>
      {run.status === 'completed' || run.status === 'completed_with_errors' ? (
        <Section className="mt-6">
          <SectionHeading>Result</SectionHeading>
          <WidgetGrid className="mt-3">
            <Widget title="Created" value={run.rowsCreated} />
            <Widget title="Matched existing customers" value={run.rowsUpdated} />
            <Widget title="Skipped" value={run.rowsSkipped} />
            <Widget title="Failed" value={run.rowsFailed} />
          </WidgetGrid>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={`/organizations/${organizationId}/customers`} tone="primary" size="small">
              View customers
            </ButtonLink>
            <ButtonLink href={libraryImportHref(organizationId, runId, `?status=failed`)} tone="secondary" size="small">
              Review problems
            </ButtonLink>
          </div>
        </Section>
      ) : run.status === 'pending' || run.status === 'running' ? (
        <Section className="mt-6">
          <SectionHeading>Review</SectionHeading>
          <Hint className="mt-1">
            {readyCount} row{readyCount === 1 ? '' : 's'} ready to import. {run.rowsSeen - readyCount} skipped — duplicates,
            invalid rows and anything with no value mapped to Name.
          </Hint>
          <div className="mt-4">
            <ApplyImportForm organizationId={organizationId} runId={runId} readyCount={readyCount} />
            {run.status === 'pending' ? (
              <form action={resumeImportStagingAction} className="mt-2">
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="runId" value={runId} />
                <Button type="submit" tone="secondary">Resume staging</Button>
              </form>
            ) : null}
          </div>
        </Section>
      ) : (
        <Hint className="mt-6">This import is still running.</Hint>
      )}

      <Section className="mt-8">
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
              { key: 'key', header: 'Row', emphasis: 'primary', cell: (row) => row.sourceRecordKey },
              { key: 'name', header: 'Name', cell: (row) => (row.normalized as { name?: string }).name ?? '—' },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <Badge tone={row.status === 'ready' || row.status === 'applied' ? 'success' : 'neutral'}>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                ),
              },
              { key: 'action', header: 'Action', emphasis: 'secondary', cell: (row) => row.proposedAction },
              {
                key: 'problem',
                header: 'Problem',
                emphasis: 'secondary',
                cell: (row) =>
                  row.validationErrors.length > 0 ? <span className="text-danger">{row.validationErrors.join(' ')}</span> : '—',
              },
            ]}
          />
        </div>
      </Section>
    </>
  );
}
