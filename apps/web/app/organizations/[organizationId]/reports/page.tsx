import Link from 'next/link';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listLocations } from '@/lib/domain/locations/locations';
import {
  GROUPINGS,
  GROUPING_LABELS,
  PERIODS,
  PERIOD_LABELS,
  listInvoicedAndIncurred,
  periodFor,
  totalsByCurrency,
  type Filters,
  type Grouping,
  type PeriodPreset,
} from '@/lib/domain/reporting/financials';
import {
  getReportDefinition,
  listReportDefinitions,
  listReportRoles,
} from '@/lib/domain/reporting/definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOrganization } from '@/lib/route/organization';
import { ReportAudienceForm, SaveReportForm } from './report-forms';

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
  const { by, period, customer, resource, location, report } = await searchParams;
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
        <p className="mt-1 text-sm opacity-70">
          What this business has invoiced, and what its work has consumed.
        </p>
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot see this business’s figures. Reading a total is
          a different thing from reading the rows behind it — anybody here can open one invoice
          on the job it belongs to, and this page adds a year of them up.
        </p>
      </>
    );
  }

  // **Null covers "no such report" and "not shared with your role" indistinguishably**, because
  // `report_definitions_select` simply does not return the row (D36). The page then falls back
  // to the ad-hoc view rather than saying a report exists that this person may not open.
  const savedId = one(report);
  const saved = savedId ? await getReportDefinition(db, { organizationId, id: savedId }) : null;

  const grouping: Grouping =
    saved?.grouping ??
    (typeof by === 'string' && (GROUPINGS as readonly string[]).includes(by)
      ? (by as Grouping)
      : 'customer');

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
  const [groups, customers, resources, locations, definitions, roles] = await Promise.all([
    // **The saved report and the ad-hoc view take the same road.** A saved report is arguments,
    // so opening one narrows to the same call rather than to a second query (D35, D36).
    listInvoicedAndIncurred(db, {
      organizationId,
      grouping,
      period: periodFor(preset, today),
      filters,
    }),
    listCustomers(db, { organizationId }),
    listResources(db, { organizationId }),
    listLocations(db, { organizationId }),
    listReportDefinitions(db, { organizationId }),
    mayManage ? listRoles(db, { organizationId }) : Promise.resolve([]),
  ]);

  const shared = mayManage
    ? await Promise.all(
        definitions.map(async (definition) => ({
          id: definition.id,
          roleIds: await listReportRoles(db, { organizationId, reportId: definition.id }),
        })),
      )
    : [];

  const totals = totalsByCurrency(groups);
  const kept = [
    filters.customerId ? `&customer=${filters.customerId}` : '',
    filters.resourceId ? `&resource=${filters.resourceId}` : '',
    filters.locationId ? `&location=${filters.locationId}` : '',
  ].join('');
  const link = (next: { by?: Grouping; period?: PeriodPreset }) =>
    `/organizations/${organizationId}/reports?by=${next.by ?? grouping}&period=${next.period ?? preset}${kept}`;

  return (
    <>
      <p className="mt-1 text-sm opacity-70">
        What this business has invoiced, and what its work has consumed. Dated by the day on the
        invoice and the day the cost was incurred — not the day either was typed in. Times read
        in {organization.timezone}.
      </p>

      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {GROUPINGS.map((option) => (
          <Link
            key={option}
            href={link({ by: option })}
            className={option === grouping ? 'font-medium' : 'opacity-70'}
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
            className={option === preset ? 'font-medium' : 'opacity-70'}
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
            <span className="opacity-70">{heading}</span>
            <select
              name={name}
              defaultValue={
                (name === 'customer'
                  ? filters.customerId
                  : name === 'resource'
                    ? filters.resourceId
                    : filters.locationId) ?? ''
              }
              className="rounded border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
            >
              <option value="">Any</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="submit"
          className="rounded border border-black/15 px-3 py-1 dark:border-white/20"
        >
          Narrow
        </button>
      </form>

      {definitions.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <span className="opacity-70">Saved:</span>
          {definitions.map((definition) => (
            <Link
              key={definition.id}
              href={`/organizations/${organizationId}/reports?report=${definition.id}`}
              className={definition.id === saved?.id ? 'font-medium' : 'opacity-70'}
            >
              {definition.name}
            </Link>
          ))}
          {saved ? (
            <Link href={`/organizations/${organizationId}/reports`} className="opacity-70">
              Clear
            </Link>
          ) : null}
        </nav>
      ) : null}

      {groups.length === 0 ? (
        <p className="mt-8 text-sm opacity-70">
          Nothing invoiced in this period
          {filters.customerId || filters.resourceId || filters.locationId
            ? ' for what you have narrowed to'
            : ''}
          . Work that has been priced but not yet invoiced does not appear here — a quote carries
          no date anybody chose, so there is no honest way to count it into a month.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left dark:border-white/15">
                <th className="py-2 pr-4 font-medium">{GROUPING_LABELS[grouping]}</th>
                <th className="py-2 pr-4 text-right font-medium">Invoiced</th>
                <th className="py-2 pr-4 text-right font-medium">Incurred</th>
                <th className="py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={`${group.groupId ?? group.label ?? 'none'}-${group.currency}`}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2 pr-4">
                    {group.label ?? <span className="opacity-70">Not attributed</span>}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(group.invoicedMinor, group.currency)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {group.incurredMinor === null
                      ? '—'
                      : formatMoney(group.incurredMinor, group.currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {group.marginMinor === null
                      ? '—'
                      : formatMoney(group.marginMinor, group.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map((total) => (
                <tr key={total.currency} className="font-medium">
                  <td className="py-2 pr-4">Total ({total.currency})</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(total.invoicedMinor, total.currency)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {total.incurredMinor === null
                      ? '—'
                      : formatMoney(total.incurredMinor, total.currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {total.marginMinor === null
                      ? '—'
                      : formatMoney(total.marginMinor, total.currency)}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      {/*
        Application state, never a claim on the business's behalf. Each of these describes why a
        column or a row reads the way it does, and every one of them is a consequence of a rule
        recorded in D35 rather than a limitation somebody forgot to fix.
      */}
      {grouping === 'service' ? (
        <p className="mt-4 text-sm opacity-70">
          A service has no cost of its own. What a job consumed is recorded against the job, and
          splitting it across the lines on that job would mean inventing a rule about how — so
          this grouping shows what was billed and nothing else.
        </p>
      ) : null}

      {totals.length > 1 ? (
        <p className="mt-4 text-sm opacity-70">
          This business has traded in more than one currency, so each is totalled separately.
          Nothing is converted, because a conversion needs a rate and a rate has a date.
        </p>
      ) : null}

      {groups.some((group) => group.label === null) ? (
        <p className="mt-4 text-sm opacity-70">
          Work with nothing recorded in this column is grouped together rather than left out, so
          the totals still add up to what was actually billed.
        </p>
      ) : null}

      {/*
        Hiding these is a courtesy, not the guard: `report_definitions_insert` requires
        report.manage in the database, so a caller reaching the action anyway is refused there.
      */}
      {mayManage ? (
        <>
          <SaveReportForm
            organizationId={organizationId}
            grouping={grouping}
            period={preset}
            filters={filters}
          />

          {definitions.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-sm font-medium">Saved reports, and who sees them</h2>
              <p className="mt-1 text-sm opacity-70">
                A report is for the roles ticked below. Somebody whose role is not ticked does
                not see it at all — the report is not hidden from them, it is not theirs to
                read.
              </p>
              <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
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
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot save reports or choose who sees them.
        </p>
      )}
    </>
  );
}
