import Link from 'next/link';
import { Button } from '@/components/controls/button';
import { Hint, SelectInput } from '@/components/controls/inputs';
import { ViewNav } from '@/components/containers/view-nav';
import { DividedList, EmptyState, SectionHeading } from '@/components/containers/section';
import type { Dashboard, DashboardTile } from '@/lib/domain/reporting/dashboards';
import type { ReportDefinition, ReportResult } from '@/lib/domain/reporting/definitions';
import {
  GROUPING_LABELS,
  GROUPINGS_FOR,
  MEASURES,
  MEASURE_LABELS,
  PERIODS,
  PERIOD_LABELS,
  type Filters,
  type Grouping,
  type Measure,
  type PeriodPreset,
} from '@/lib/domain/reporting/shape';
import { totalsByCurrency } from '@/lib/domain/reporting/financials';
import { CommittedTimeTable, FiguresTable, JobsTable } from './report-tables';
import {
  CreateDashboardForm,
  DashboardContentsForm,
  ReportAudienceForm,
  SaveReportForm,
} from './report-forms';

function reportHref({
  organizationId,
  measure,
  grouping,
  period,
  filters,
}: {
  organizationId: string;
  measure: Measure;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
}) {
  const params = new URLSearchParams({ of: measure, by: grouping, period });
  if (filters.customerId) params.set('customer', filters.customerId);
  if (filters.resourceId) params.set('resource', filters.resourceId);
  if (filters.locationId) params.set('location', filters.locationId);
  return `/organizations/${organizationId}/insights/reports?${params}`;
}

export function ReportNavigation({
  organizationId,
  measure,
  grouping,
  period,
  filters,
  answerable,
  definitions,
  savedId,
}: {
  organizationId: string;
  measure: Measure;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
  answerable: readonly Grouping[];
  definitions: ReportDefinition[];
  savedId?: string;
}) {
  const link = (next: { measure?: Measure; grouping?: Grouping; period?: PeriodPreset }) => {
    const nextMeasure = next.measure ?? measure;
    const nextGrouping = next.grouping ?? (next.measure ? GROUPINGS_FOR[nextMeasure][0] : grouping);
    return reportHref({
      organizationId,
      measure: nextMeasure,
      grouping: nextGrouping,
      period: next.period ?? period,
      filters,
    });
  };

  return (
    <>
      <nav aria-label="Report measure" className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {MEASURES.map((option) => (
          <Link key={option} href={link({ measure: option })} aria-current={option === measure ? 'page' : undefined} className={option === measure ? 'font-medium' : 'text-muted'}>
            {MEASURE_LABELS[option]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Report grouping" className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {answerable.map((option) => (
          <Link key={option} href={link({ grouping: option })} aria-current={option === grouping ? 'page' : undefined} className={option === grouping ? 'font-medium' : 'text-muted'}>
            By {GROUPING_LABELS[option].toLowerCase()}
          </Link>
        ))}
      </nav>
      <nav aria-label="Report period" className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {PERIODS.map((option) => (
          <Link key={option} href={link({ period: option })} aria-current={option === period ? 'page' : undefined} className={option === period ? 'font-medium' : 'text-muted'}>
            {PERIOD_LABELS[option]}
          </Link>
        ))}
      </nav>

      {definitions.length > 0 ? (
        <nav aria-label="Saved reports" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <span className="text-muted">Saved:</span>
          {definitions.map((definition) => (
            <Link key={definition.id} href={`/organizations/${organizationId}/insights/reports?report=${definition.id}`} aria-current={definition.id === savedId ? 'page' : undefined} className={definition.id === savedId ? 'font-medium' : 'text-muted'}>
              {definition.name}
            </Link>
          ))}
          {savedId ? <Link href={`/organizations/${organizationId}/insights/reports`} className="text-muted">Clear</Link> : null}
        </nav>
      ) : null}
    </>
  );
}

/** The saved dashboards of Insights' overview — each one a URL, so an open dashboard survives a reload. */
export function DashboardNavigation({
  organizationId,
  dashboards,
  openDashboardId,
}: {
  organizationId: string;
  dashboards: Dashboard[];
  openDashboardId?: string;
}) {
  if (dashboards.length === 0) return null;

  return (
    <nav aria-label="Dashboards" className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {dashboards.map((entry) => (
        <Link key={entry.id} href={`/organizations/${organizationId}/insights?dashboard=${entry.id}`} aria-current={entry.id === openDashboardId ? 'page' : undefined} className={entry.id === openDashboardId ? 'font-medium' : 'text-muted'}>
          {entry.name}
        </Link>
      ))}
    </nav>
  );
}

export function ReportFilters({
  grouping,
  period,
  filters,
  customers,
  resources,
  locations,
}: {
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
  customers: { id: string; name: string }[];
  resources: { id: string; name: string }[];
  locations: { id: string; label: string }[];
}) {
  const choices = [
    ['customer', 'Customer', filters.customerId, customers.map((row) => ({ id: row.id, label: row.name }))],
    ['resource', 'Resource', filters.resourceId, resources.map((row) => ({ id: row.id, label: row.name }))],
    ['location', 'Location', filters.locationId, locations],
  ] as const;

  return (
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
      <input type="hidden" name="by" value={grouping} />
      <input type="hidden" name="period" value={period} />
      {choices.map(([name, label, value, options]) => (
        <label key={name} className="flex min-w-36 flex-1 flex-col gap-1 sm:flex-none">
          <span className="text-muted">{label}</span>
          <SelectInput name={name} defaultValue={value ?? ''} className="bg-transparent px-2 py-1">
            <option value="">Any</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </SelectInput>
        </label>
      ))}
      <Button type="submit" tone="secondary" size="small">Narrow</Button>
    </form>
  );
}

function ResultTable({ result, grouping }: { result: ReportResult; grouping: Grouping }) {
  if (result.measure === 'work_marked_complete') return <JobsTable groups={result.groups} grouping={grouping} />;
  if (result.measure === 'time_committed') return <CommittedTimeTable groups={result.groups} grouping={grouping} />;
  return <FiguresTable groups={result.groups} grouping={grouping} />;
}

export function DashboardView({ tiles }: { tiles: DashboardTile[] }) {
  if (tiles.length === 0) {
    return (
      <EmptyState className="mt-8">
        Nothing on this dashboard is yours to read. That is not an empty dashboard — it is one built from reports shared with other roles.
      </EmptyState>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      {tiles.map((tile) => (
        <section key={tile.report.id}>
          <SectionHeading>{tile.report.name}</SectionHeading>
          <Hint className="mt-1">
            {MEASURE_LABELS[tile.report.measure]} by {GROUPING_LABELS[tile.report.grouping].toLowerCase()}, {PERIOD_LABELS[tile.report.period].toLowerCase()}
          </Hint>
          <div className="mt-2"><ResultTable result={tile.result} grouping={tile.report.grouping} /></div>
        </section>
      ))}
    </div>
  );
}

export function ReportResultView({ result, grouping, filters }: { result: ReportResult; grouping: Grouping; filters: Filters }) {
  if (result.groups.length === 0) {
    const narrowed = filters.customerId || filters.resourceId || filters.locationId ? ' for what you have narrowed to' : '';
    const empty = result.measure === 'work_marked_complete'
      ? `No work was marked complete in this period${narrowed}.`
      : result.measure === 'time_committed'
        ? `No resource time was committed in this period${narrowed}.`
        : `Nothing invoiced in this period${narrowed}. Work that has been priced but not yet invoiced does not appear here — a quote carries no date anybody chose, so there is no honest way to count it into a month.`;
    return <EmptyState className="mt-8">{empty}</EmptyState>;
  }

  const totals = result.measure === 'invoiced_and_incurred' ? totalsByCurrency(result.groups) : [];
  return (
    <>
      <div className="mt-6"><ResultTable result={result} grouping={grouping} /></div>
      {grouping === 'service' ? <Hint className="mt-4">A service has no cost of its own. What a job consumed is recorded against the job, and splitting it across the lines on that job would mean inventing a rule about how — so this grouping shows what was billed and nothing else.</Hint> : null}
      {totals.length > 1 ? <Hint className="mt-4">This business has traded in more than one currency, so each is totalled separately. Nothing is converted, because a conversion needs a rate and a rate has a date.</Hint> : null}
      {result.groups.some((group) => group.label === null) ? <Hint className="mt-4">Work with nothing recorded in this column is grouped together rather than left out, so the totals still add up to what was actually recorded.</Hint> : null}
    </>
  );
}

export function ReportManagement({
  organizationId,
  measure,
  grouping,
  period,
  filters,
  definitions,
  roles,
  shared,
  mayManage,
  role,
}: {
  organizationId: string;
  measure: Measure;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
  definitions: ReportDefinition[];
  roles: { id: string; name: string }[];
  shared: { id: string; roleIds: string[] }[];
  mayManage: boolean;
  role: string;
}) {
  if (!mayManage) return <Hint className="mt-8">Your role, {role}, cannot save reports or choose who sees them.</Hint>;

  return (
    <>
      <SaveReportForm organizationId={organizationId} measure={measure} grouping={grouping} period={period} filters={filters} />
      {definitions.length > 0 ? (
        <section className="mt-8">
          <SectionHeading>Saved reports, and who sees them</SectionHeading>
          <Hint className="mt-1">A report is for the roles ticked below. Somebody whose role is not ticked does not see it at all — the report is not hidden from them, it is not theirs to read.</Hint>
          <DividedList className="mt-2">
            {definitions.map((definition) => (
              <li key={definition.id}><ReportAudienceForm organizationId={organizationId} report={definition} roles={roles} shared={shared.find((row) => row.id === definition.id)?.roleIds ?? []} /></li>
            ))}
          </DividedList>
        </section>
      ) : null}
    </>
  );
}

/** Building a dashboard: naming one and choosing which saved reports sit on it. Lives on Insights' overview, beside the dashboards it makes. */
export function DashboardManagement({
  organizationId,
  definitions,
  dashboards,
  pinnedByDashboard,
  mayManage,
}: {
  organizationId: string;
  definitions: ReportDefinition[];
  dashboards: Dashboard[];
  pinnedByDashboard: Map<string, string[]>;
  mayManage: boolean;
}) {
  if (!mayManage) return null;

  return (
      <section className="mt-8">
        <SectionHeading>Dashboards</SectionHeading>
        <Hint className="mt-1">A dashboard is saved reports side by side. It has no audience of its own — somebody sees it when something on it is theirs to read, which is why this platform ships none and a business builds its own.</Hint>
        <CreateDashboardForm organizationId={organizationId} />
        {dashboards.length > 0 ? (
          <DividedList className="mt-2">
            {dashboards.map((dashboard) => (
              <li key={dashboard.id}><DashboardContentsForm organizationId={organizationId} dashboard={dashboard} reports={definitions.map(({ id, name }) => ({ id, name }))} pinned={pinnedByDashboard.get(dashboard.id) ?? []} /></li>
            ))}
          </DividedList>
        ) : null}
      </section>
  );
}

/** Insights' two views. Each is a URL, so a report or dashboard opened from either survives a reload. */
export function InsightsViewNav({ organizationId, current }: { organizationId: string; current: 'overview' | 'reports' }) {
  return (
    <ViewNav
      label="Insights views"
      current={current}
      className="mt-6"
      views={[
        { key: 'overview', label: 'Overview', href: `/organizations/${organizationId}/insights` },
        { key: 'reports', label: 'Reports', href: `/organizations/${organizationId}/insights/reports` },
      ]}
    />
  );
}
