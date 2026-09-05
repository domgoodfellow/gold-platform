import { Button } from '@/components/controls/button';
import { DividedList, EmptyState, SectionHeading } from '@/components/containers/section';
import { Hint, SelectInput } from '@/components/controls/inputs';
import Link from 'next/link';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listLocations } from '@/lib/domain/locations/locations';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { listTimeCommitted } from '@/lib/domain/reporting/commitment';
import { listWorkMarkedComplete } from '@/lib/domain/reporting/completion';
import {
  GROUPINGS_FOR,
  GROUPING_LABELS,
  MEASURES,
  MEASURE_LABELS,
  PERIODS,
  PERIOD_LABELS,
  periodFor,
  type Filters,
  type Grouping,
  type Measure,
  type PeriodPreset,
} from '@/lib/domain/reporting/shape';
import {
  listDashboards,
  readDashboard,
} from '@/lib/domain/reporting/dashboards';
import {
  getReportDefinition,
  listReportDefinitions,
  listReportRoles,
} from '@/lib/domain/reporting/definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { requireOrganization } from '@/lib/route/organization';
import { CommittedTimeTable, FiguresTable, JobsTable } from './report-tables';
import {
  CreateDashboardForm,
  DashboardContentsForm,
  ReportAudienceForm,
  SaveReportForm,
} from './report-forms';

export const dynamic = 'force-dynamic';

/**
 * What this business billed, what its work consumed, and the difference.
 *
 * **It computes nothing**, exactly as `TodayPage` computes nothing: every figure comes from
 * `invoiced_and_incurred`, the one aggregate (D35), and the only arithmetic on this page is
 * `totalsByCurrency` — which is a domain function rather than a `reduce` here, for the reason
 * I4 gives about prices.
 *
 * **It says "invoiced" and never "revenue", and the page says why.** Work that has been priced
 * and not billed is absent from every figure below, because a priced line's only date is the
 * instant somebody typed it and a period report needs a date a person chose. A business that
 * invoices in another system therefore sees an empty page — which is the honest answer and the
 * thing worth finding out.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/reports'>) {
  const { organizationId } = await params;
  const { by, of: ofMeasure, period, customer, resource, location, report, dashboard } =
    await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  // A uuid or nothing. Not validated further here: an id from another business narrows to no
  // rows because RLS never lets those rows into the query, which is the same reason the
  // organization id is not what narrows (D34).
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' && value.length > 0 ? value : null;

  // **A courtesy, not the guard.** `invoiced_and_incurred` raises `42501` for a caller without
  // `report.read`, so somebody reaching this page's data another way is refused by the database
  // exactly as they would be here. What this avoids is showing a role an error where a sentence
  // is the honest answer (I12).
  if (!organization.capabilities.includes('report.read')) {
    return (
      <>
        <Hint className="mt-1">
          What this business has invoiced, and what its work has consumed.
        </Hint>
        <Hint className="mt-8">
          Your role, {organization.role}, cannot see this business’s figures. Reading a total is
          a different thing from reading the rows behind it — anybody here can open one invoice
          on the job it belongs to, and this page adds a year of them up.
        </Hint>
      </>
    );
  }

  // **Null covers "no such report" and "not shared with your role" indistinguishably**, because
  // `report_definitions_select` simply does not return the row (D36). The page then falls back
  // to the ad-hoc view rather than saying a report exists that this person may not open.
  const savedId = one(report);
  const saved = savedId ? await getReportDefinition(db, { organizationId, id: savedId }) : null;

  const measure: Measure =
    saved?.measure ??
    (typeof ofMeasure === 'string' && (MEASURES as readonly string[]).includes(ofMeasure)
      ? (ofMeasure as Measure)
      : 'invoiced_and_incurred');

  // **Only the groupings this measure can answer**, so a grouping that would return nothing is
  // not offered and a stale link falls back rather than showing an empty table with no reason.
  const answerable = GROUPINGS_FOR[measure];
  const grouping: Grouping =
    saved?.grouping ??
    (typeof by === 'string' && (answerable as readonly string[]).includes(by)
      ? (by as Grouping)
      : answerable[0]);

  const preset: PeriodPreset =
    saved?.period ??
    (typeof period === 'string' && (PERIODS as readonly string[]).includes(period)
      ? (period as PeriodPreset)
      : 'year');

  const filters: Filters = saved?.filters ?? {
    customerId: one(customer),
    resourceId: one(resource),
    locationId: one(location),
  };

  const mayManage = organization.capabilities.includes('report.manage');

  // This business's today, so "this month" begins where the business is (I9).
  const today = todayInZone(organization.timezone);
  const args = { organizationId, grouping, period: periodFor(preset, today), filters };
  const [result, customers, resources, locations, definitions, roles] = await Promise.all([
    // **The saved report and the ad-hoc view take the same road.** A saved report is arguments,
    // so opening one narrows to the same call rather than to a second query (D35, D36).
    measure === 'work_marked_complete'
      ? listWorkMarkedComplete(db, args).then((groups) => ({ measure, groups }) as const)
      : measure === 'time_committed'
        ? listTimeCommitted(db, args).then((groups) => ({ measure, groups }) as const)
        : listInvoicedAndIncurred(db, args).then(
            (groups) => ({ measure: 'invoiced_and_incurred' as const, groups }),
          ),
    listCustomers(db, { organizationId }),
    listResources(db, { organizationId }),
    listLocations(db, { organizationId }),
    listReportDefinitions(db, { organizationId }),
    mayManage ? listRoles(db, { organizationId }) : Promise.resolve([]),
  ]);

  // **What this caller can see, which is not necessarily what exists.** `dashboards_select`
  // returns a dashboard only when at least one report pinned to it is one they may read, so a
  // dashboard made of somebody else's reports is absent rather than empty (D36).
  const dashboards = await listDashboards(db, { organizationId });
  const openDashboard = dashboards.find((entry) => entry.id === one(dashboard)) ?? null;
  const tiles = openDashboard
    ? await readDashboard(db, { organizationId, dashboardId: openDashboard.id, today })
    : [];

  // Which reports are already on each dashboard, so the management list can say so. Read
  // straight from the pins rather than through `readDashboard`, which would run every report on
  // every dashboard to draw a list of names.
  const pinnedByDashboard = new Map<string, string[]>();
  if (mayManage && dashboards.length > 0) {
    const { data: pins } = await db
      .from('dashboard_reports')
      .select('dashboard_id, report_id')
      .eq('organization_id', organizationId);

    for (const pin of pins ?? []) {
      pinnedByDashboard.set(pin.dashboard_id, [
        ...(pinnedByDashboard.get(pin.dashboard_id) ?? []),
        pin.report_id,
      ]);
    }
  }

  const shared = mayManage
    ? await Promise.all(
        definitions.map(async (definition) => ({
          id: definition.id,
          roleIds: await listReportRoles(db, { organizationId, reportId: definition.id }),
        })),
      )
    : [];

  const groups = result.groups;
  const totals = result.measure === 'invoiced_and_incurred' ? totalsByCurrency(result.groups) : [];
  const kept = [
    filters.customerId ? `&customer=${filters.customerId}` : '',
    filters.resourceId ? `&resource=${filters.resourceId}` : '',
    filters.locationId ? `&location=${filters.locationId}` : '',
  ].join('');
  const link = (next: { by?: Grouping; of?: Measure; period?: PeriodPreset }) => {
    // A measure change resets the grouping to one that measure can answer, rather than carrying
    // an unanswerable pair into a link somebody might keep.
    const nextMeasure = next.of ?? measure;
    const nextGrouping = next.by ?? (next.of ? GROUPINGS_FOR[next.of][0] : grouping);
    return `/organizations/${organizationId}/reports?of=${nextMeasure}&by=${nextGrouping}&period=${next.period ?? preset}${kept}`;
  };

  const dashboardNav =
    dashboards.length > 0 ? (
      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <span className="text-muted">Dashboards:</span>
        {dashboards.map((entry) => (
          <Link
            key={entry.id}
            href={`/organizations/${organizationId}/reports?dashboard=${entry.id}`}
            className={entry.id === openDashboard?.id ? 'font-medium' : 'text-muted'}
          >
            {entry.name}
          </Link>
        ))}
        {openDashboard ? (
          <Link href={`/organizations/${organizationId}/reports`} className="text-muted">
            Back to figures
          </Link>
        ) : null}
      </nav>
    ) : null;

  if (openDashboard) {
    return (
      <>
        <Hint className="mt-1">
          {openDashboard.name} · figures worked out now, in {organization.timezone}.
        </Hint>

        {dashboardNav}

        {/*
          **Each tile is what this viewer may read, and nothing here filters them.** A report
          pinned to this dashboard that their role does not name is not returned by the
          database, so it is absent rather than empty — which is why one dashboard can show two
          people different things with no code deciding it (D36).
        */}
        {tiles.length === 0 ? (
          <EmptyState className="mt-8">
            Nothing on this dashboard is yours to read. That is not an empty dashboard — it is
            one built from reports shared with other roles.
          </EmptyState>
        ) : (
          <div className="mt-6 flex flex-col gap-8">
            {tiles.map((tile) => (
              <section key={tile.report.id}>
                <SectionHeading>{tile.report.name}</SectionHeading>
                <Hint className="mt-1">
                  {MEASURE_LABELS[tile.report.measure]} by{' '}
                  {GROUPING_LABELS[tile.report.grouping].toLowerCase()},{' '}
                  {PERIOD_LABELS[tile.report.period].toLowerCase()}
                </Hint>
                <div className="mt-2">
                  {tile.result.measure === 'work_marked_complete' ? (
                    <JobsTable groups={tile.result.groups} grouping={tile.report.grouping} />
                  ) : tile.result.measure === 'time_committed' ? (
                    <CommittedTimeTable
                      groups={tile.result.groups}
                      grouping={tile.report.grouping}
                    />
                  ) : (
                    <FiguresTable groups={tile.result.groups} grouping={tile.report.grouping} />
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Hint className="mt-1">
        What this business has invoiced, and what its work has consumed. Dated by the day on the
        invoice and the day the cost was incurred — not the day either was typed in. Times read
        in {organization.timezone}.
      </Hint>

      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {MEASURES.map((option) => (
          <Link
            key={option}
            href={link({ of: option })}
            className={option === measure ? 'font-medium' : 'text-muted'}
          >
            {MEASURE_LABELS[option]}
          </Link>
        ))}
      </nav>

      {/*
        Only the groupings this measure can answer. Completed work has no service grouping — a
        job is finished as a whole — so it is not offered rather than offered and then empty.
      */}
      <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {answerable.map((option) => (
          <Link
            key={option}
            href={link({ by: option })}
            className={option === grouping ? 'font-medium' : 'text-muted'}
          >
            By {GROUPING_LABELS[option].toLowerCase()}
          </Link>
        ))}
      </nav>

      <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {PERIODS.map((option) => (
          <Link
            key={option}
            href={link({ period: option })}
            className={option === preset ? 'font-medium' : 'text-muted'}
          >
            {PERIOD_LABELS[option]}
          </Link>
        ))}
      </nav>

      {/*
        A plain GET form, so narrowing needs no client component and every view of this page has
        a URL somebody can keep. The grouping and the period ride along as hidden fields, because
        changing a filter must not silently reset the two choices above it.
      */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="by" value={grouping} />
        <input type="hidden" name="period" value={preset} />
        {(
          [
            ['customer', 'Customer', customers.map((row) => ({ id: row.id, label: row.name }))],
            ['resource', 'Resource', resources.map((row) => ({ id: row.id, label: row.name }))],
            ['location', 'Location', locations.map((row) => ({ id: row.id, label: row.label }))],
          ] as const
        ).map(([name, heading, options]) => (
          <label key={name} className="flex flex-col gap-1">
            <span className="text-muted">{heading}</span>
            <SelectInput
              name={name}
              defaultValue={
                (name === 'customer'
                  ? filters.customerId
                  : name === 'resource'
                    ? filters.resourceId
                    : filters.locationId) ?? ''
              }
              className="bg-transparent px-2 py-1"
            >
              <option value="">Any</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </label>
        ))}
        <Button type="submit" tone="secondary" size="small">
          Narrow
        </Button>
      </form>

      {dashboardNav}

      {definitions.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <span className="text-muted">Saved:</span>
          {definitions.map((definition) => (
            <Link
              key={definition.id}
              href={`/organizations/${organizationId}/reports?report=${definition.id}`}
              className={definition.id === saved?.id ? 'font-medium' : 'text-muted'}
            >
              {definition.name}
            </Link>
          ))}
          {saved ? (
            <Link href={`/organizations/${organizationId}/reports`} className="text-muted">
              Clear
            </Link>
          ) : null}
        </nav>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState className="mt-8">
          Nothing invoiced in this period
          {filters.customerId || filters.resourceId || filters.locationId
            ? ' for what you have narrowed to'
            : ''}
          . Work that has been priced but not yet invoiced does not appear here — a quote carries
          no date anybody chose, so there is no honest way to count it into a month.
        </EmptyState>
      ) : (
        <div className="mt-6">
          {result.measure === 'work_marked_complete' ? (
            <JobsTable groups={result.groups} grouping={grouping} />
          ) : result.measure === 'time_committed' ? (
            <CommittedTimeTable groups={result.groups} grouping={grouping} />
          ) : (
            <FiguresTable groups={result.groups} grouping={grouping} />
          )}
        </div>
      )}

      {/*
        Application state, never a claim on the business's behalf. Each of these describes why a
        column or a row reads the way it does, and every one of them is a consequence of a rule
        recorded in D35 rather than a limitation somebody forgot to fix.
      */}
      {grouping === 'service' ? (
        <Hint className="mt-4">
          A service has no cost of its own. What a job consumed is recorded against the job, and
          splitting it across the lines on that job would mean inventing a rule about how — so
          this grouping shows what was billed and nothing else.
        </Hint>
      ) : null}

      {totals.length > 1 ? (
        <Hint className="mt-4">
          This business has traded in more than one currency, so each is totalled separately.
          Nothing is converted, because a conversion needs a rate and a rate has a date.
        </Hint>
      ) : null}

      {groups.some((group) => group.label === null) ? (
        <Hint className="mt-4">
          Work with nothing recorded in this column is grouped together rather than left out, so
          the totals still add up to what was actually billed.
        </Hint>
      ) : null}

      {/*
        Hiding these is a courtesy, not the guard: `report_definitions_insert` requires
        report.manage in the database, so a caller reaching the action anyway is refused there.
      */}
      {mayManage ? (
        <>
          <SaveReportForm
            organizationId={organizationId}
            measure={measure}
            grouping={grouping}
            period={preset}
            filters={filters}
          />

          {definitions.length > 0 ? (
            <section className="mt-8">
              <SectionHeading>Saved reports, and who sees them</SectionHeading>
              <Hint className="mt-1">
                A report is for the roles ticked below. Somebody whose role is not ticked does
                not see it at all — the report is not hidden from them, it is not theirs to
                read.
              </Hint>
              <DividedList className="mt-2">
                {definitions.map((definition) => (
                  <li key={definition.id}>
                    <ReportAudienceForm
                      organizationId={organizationId}
                      report={definition}
                      roles={roles.map((role) => ({ id: role.id, name: role.name }))}
                      shared={shared.find((row) => row.id === definition.id)?.roleIds ?? []}
                    />
                  </li>
                ))}
              </DividedList>
            </section>
          ) : null}

          <section className="mt-8">
            <SectionHeading>Dashboards</SectionHeading>
            <Hint className="mt-1">
              A dashboard is saved reports side by side. It has no audience of its own — somebody
              sees it when something on it is theirs to read, which is why this platform ships
              none and a business builds its own.
            </Hint>

            <CreateDashboardForm organizationId={organizationId} />

            {dashboards.length > 0 ? (
              <DividedList className="mt-2">
                {dashboards.map((entry) => (
                  <li key={entry.id}>
                    <DashboardContentsForm
                      organizationId={organizationId}
                      dashboard={entry}
                      reports={definitions.map((definition) => ({
                        id: definition.id,
                        name: definition.name,
                      }))}
                      pinned={pinnedByDashboard.get(entry.id) ?? []}
                    />
                  </li>
                ))}
              </DividedList>
            ) : null}
          </section>
        </>
      ) : (
        <Hint className="mt-8">
          Your role, {organization.role}, cannot save reports or choose who sees them.
        </Hint>
      )}
    </>
  );
}
