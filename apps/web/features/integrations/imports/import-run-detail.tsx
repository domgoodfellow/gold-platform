import { Button, ButtonLink } from '@/components/controls/button';
import { resumeImportStagingAction } from '@/app/organizations/[organizationId]/library/imports/[runId]/actions';
import { Hint } from '@/components/controls/inputs';
import { Card } from '@/components/surfaces/card';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { WidgetGrid, Widget } from '@/components/display/widget';
import type { ImportRun, StagingRow, StagingRowStatus } from '@/lib/domain/integrations/import-runs';
import type { ContactCurrentValues, ContactSummary } from '@/lib/domain/contacts/contacts';
import { classificationLabel } from '@/lib/domain/customers/classification';
import { ApplyImportForm } from './apply-import-form';
import { ImportRowDecisionField, SkipUndecidedRows, type DecisionChoice } from './import-row-decision';
import { libraryImportHref, librarySourceHref } from '@/lib/route/library';

const STATUS_LABEL: Record<StagingRowStatus, string> = {
  ready: 'Ready',
  review: 'Needs review',
  duplicate: 'Possible duplicate',
  invalid: 'Rejected',
  ignored: 'Skipped',
  applied: 'Applied',
  failed: 'Failed',
};

const FILTERS: { key: StagingRowStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'review', label: 'Needs review' },
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
    review: rows.filter(row => row.status === 'review').length,
    duplicates: rows.filter(row => row.status === 'duplicate').length,
    skipped: rows.filter(row => row.status === 'invalid' || row.status === 'ignored').length,
    unclassified: ready.filter(row => row.proposedAction === 'create' && !['person', 'company'].includes(typeOf(row))).length,
  };
}

/** Why staging matched a row, naming the contacts involved. Only what was recorded; never a guess. */
export function matchDescription(row: StagingRow, contacts: ReadonlyMap<string, ContactSummary>): string {
  const names = (ids: (string | null)[]) => ids.filter((id): id is string => Boolean(id)).map(id => contacts.get(id)?.name ?? 'a contact').join(', ');
  switch (row.matchReason) {
    case 'source': return `Linked to ${names([row.matchedCustomerId])} by source ID`;
    case 'source_other_file': return `Imported before from another file as ${names(row.candidateIds)}`;
    case 'source_deleted': return 'Imported before; its contact was deleted';
    case 'email': return `Same email as ${names([row.matchedCustomerId])}`;
    case 'email_shared': return `Email used by ${names(row.candidateIds)}`;
    case 'email_unconfirmed': return `Same email as ${names(row.candidateIds)}`;
    case 'phone': return `Same phone number as ${names(row.candidateIds)}`;
    case 'phone_in_file': return 'Same phone number as an earlier row';
    case 'email_in_file': return 'Same email as an earlier row';
    case 'contact_in_file': return 'Another row updates the same contact';
    default: return '—';
  }
}

export type ImportChange = { field: string; label: string; current: string; incoming: string };

const CONTACT_TYPE_LABEL: Record<string, string> = { person: 'Person', company: 'Company', unspecified: 'Unspecified' };

/**
 * What applying an Update would change on the contact: each mapped value that differs from what the
 * contact holds now, as current and incoming. Mirrors the apply rules: an empty incoming value keeps
 * the current one, an Unspecified type never replaces a known one, and fields are added to, not
 * cleared. Conflicts with local edits are still decided when applying.
 */
export function importChanges(row: StagingRow, current: ContactCurrentValues | undefined, fieldLabels: Readonly<Record<string, string>> = {}): ImportChange[] {
  if (!current) return [];
  const incoming = row.normalized as Record<string, unknown> & { custom?: Record<string, unknown> };
  const text = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));
  const changes: ImportChange[] = [];
  const compare = (field: string, label: string, next: unknown, now: unknown, show: (value: unknown) => string = text) => {
    if (next === null || next === undefined || next === '') return;
    if (String(next) === String(now ?? '')) return;
    changes.push({ field, label, current: show(now), incoming: show(next) });
  };
  compare('name', 'Name', incoming.name, current.name);
  compare('email', 'Email', incoming.email, current.email);
  compare('phone', 'Phone', incoming.phone, current.phone);
  if (incoming.contact_type !== 'unspecified') compare('contact_type', 'Type', incoming.contact_type, current.contactType, value => CONTACT_TYPE_LABEL[String(value)] ?? text(value));
  compare('lifecycle', 'Lifecycle', incoming.lifecycle, current.lifecycle, value => (value ? classificationLabel(String(value)) : '—'));
  compare('lead_temperature', 'Temperature', incoming.lead_temperature, current.leadTemperature, value => (value ? classificationLabel(String(value)) : '—'));
  for (const [key, value] of Object.entries(incoming.custom ?? {})) {
    const now = (current.custom as Record<string, unknown>)[key];
    if (JSON.stringify(value) === JSON.stringify(now ?? null)) continue;
    if (value === null || value === undefined || value === '') continue;
    changes.push({ field: `custom.${key}`, label: fieldLabels[key] ?? key, current: text(Array.isArray(now) ? now.join(', ') : now), incoming: text(Array.isArray(value) ? value.join(', ') : value) });
  }
  return changes;
}

/** What a person may decide for a row still waiting to be imported; none once it is applied, rejected or a repeat. */
export function decisionChoices(row: StagingRow, contacts: ReadonlyMap<string, ContactSummary>): DecisionChoice[] | null {
  if (row.status !== 'ready' && row.status !== 'review' && row.status !== 'ignored') return null;
  const targets = [...new Set([...row.candidateIds, ...(row.matchedCustomerId ? [row.matchedCustomerId] : [])])];
  return [
    // A row linked by its source ID is that contact, and one email is one contact: neither becomes a second one.
    ...(row.matchReason && ['source', 'email', 'email_shared', 'email_unconfirmed'].includes(row.matchReason) ? [] : [{ value: 'create', label: 'Create new contact' }]),
    ...targets.map(id => ({ value: `update:${id}`, label: `Update ${contacts.get(id)?.name ?? 'contact'}` })),
    { value: 'skip', label: 'Skip' },
  ];
}

function decisionValue(row: StagingRow): string {
  if (row.status === 'review') return '';
  if (row.status === 'ignored') return 'skip';
  return row.proposedAction === 'update' && row.matchedCustomerId ? `update:${row.matchedCustomerId}` : 'create';
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
  contacts,
  fieldLabels = {},
  mayReview = true,
}: {
  organizationId: string;
  runId: string;
  run: ImportRun;
  rows: StagingRow[];
  summary: ReturnType<typeof summarizeStaging>;
  readyCount: number;
  status?: StagingRowStatus;
  /** The existing contacts rows were matched to or might be, by id, with their current values. */
  contacts: ReadonlyMap<string, ContactSummary | ContactCurrentValues>;
  /** Custom field labels by key, for the Changes column. */
  fieldLabels?: Readonly<Record<string, string>>;
  /** Whether this member may decide rows: choosing between contacts needs `customer.read`. */
  mayReview?: boolean;
}) {
  const finished = run.status === 'completed' || run.status === 'completed_with_errors';
  return (
    <>
      {finished ? (
        <Card as="section" aria-labelledby="import-results" className="shrink-0">
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
        <Card as="section" aria-labelledby="import-review" className="shrink-0">
          <h2 id="import-review" className="text-sm font-semibold">Review changes</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Staged changes">
            {[['New contacts', summary.created], ['Updates to existing contacts', summary.updated], ['Needs review', summary.review], ['Possible duplicates (not applied)', summary.duplicates], ['Skipped or rejected', summary.skipped]].map(([label, value]) =>
              <div key={label} className="rounded-md bg-secondary px-3 py-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
          {summary.unclassified ? <p role="status" className="mt-3 text-sm">{summary.unclassified} new contact{summary.unclassified === 1 ? '' : 's'} will be saved as Unspecified / Needs classification because no contact type was mapped.</p> : null}
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Apply</p>
            <Hint>Nothing has been written to Contacts yet.</Hint>
            {summary.review ? <>
              <p role="status" className="text-sm">Decide the {summary.review} row{summary.review === 1 ? '' : 's'} marked Needs review before importing.</p>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={libraryImportHref(organizationId, runId, '?status=review')} tone="secondary">Show rows needing review</ButtonLink>
                <SkipUndecidedRows organizationId={organizationId} runId={runId} count={summary.review} />
              </div>
            </> : null}
            <ApplyImportForm organizationId={organizationId} runId={runId} readyCount={readyCount} blocked={summary.review > 0} />
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

      <section aria-label="Rows to import" className="mt-8">
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
              { key: 'match', header: 'Match', cell: (row) => matchDescription(row, contacts) },
              {
                key: 'decision',
                header: 'Action',
                cell: (row) => {
                  const choices = finished || !mayReview ? null : decisionChoices(row, contacts);
                  if (!choices) return row.proposedAction === 'create' ? 'New contact' : row.proposedAction === 'update' ? 'Update existing contact' : 'Skip';
                  const name = String((row.normalized as { name?: string }).name ?? 'row');
                  return <ImportRowDecisionField organizationId={organizationId} runId={runId} rowId={row.id} rowName={name} value={decisionValue(row)} choices={choices} />;
                },
              },
              {
                key: 'changes',
                header: 'Changes',
                cell: (row) => {
                  // Before applying: what an Update would change on the chosen contact.
                  if (finished || row.status !== 'ready' || row.proposedAction !== 'update' || !row.matchedCustomerId) return '—';
                  const current = contacts.get(row.matchedCustomerId);
                  const changes = current && 'contactType' in current ? importChanges(row, current, fieldLabels) : [];
                  if (!changes.length) return <span className="text-muted">No changes</span>;
                  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">{changes.map(change => <div key={change.field} className="contents">
                    <dt className="text-muted">{change.label}</dt>
                    <dd className="min-w-0 break-words"><span className="sr-only">from </span><span className="text-muted line-through decoration-muted">{change.current}</span> <span aria-hidden>→</span><span className="sr-only"> to</span> <span className="font-medium">{change.incoming}</span></dd>
                  </div>)}</dl>;
                },
              },
              {
                key: 'problem',
                header: 'Problem',
                visibility: 'card-only',
                cell: (row) =>
                  row.validationErrors.length > 0 ? <span className="text-danger">{row.validationErrors.join(' ')}</span> : '—',
              },
              // The stable source key is long and machine-made; its end is enough to tell rows apart, and the whole key stays available.
              { key: 'key', header: 'Row', visibility: 'card-only', cell: (row) => <span title={row.sourceRecordKey} className="font-mono text-xs text-muted">…{row.sourceRecordKey.slice(-8)}</span> },
            ]}
          />
        </div>
      </section>
    </>
  );
}
