import Link from 'next/link';
import {
  GROUPINGS,
  GROUPING_LABELS,
  PERIODS,
  PERIOD_LABELS,
  listInvoicedAndIncurred,
  periodFor,
  totalsByCurrency,
  type Grouping,
  type PeriodPreset,
} from '@/lib/domain/reporting/financials';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOrganization } from '@/lib/route/organization';

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
  const { by, period } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const grouping: Grouping =
    typeof by === 'string' && (GROUPINGS as readonly string[]).includes(by)
      ? (by as Grouping)
      : 'customer';

  const preset: PeriodPreset =
    typeof period === 'string' && (PERIODS as readonly string[]).includes(period)
      ? (period as PeriodPreset)
      : 'year';

  // This business's today, so "this month" begins where the business is (I9).
  const today = todayInZone(organization.timezone);
  const groups = await listInvoicedAndIncurred(db, {
    organizationId,
    grouping,
    period: periodFor(preset, today),
  });

  const totals = totalsByCurrency(groups);
  const link = (next: { by?: Grouping; period?: PeriodPreset }) =>
    `/organizations/${organizationId}/reports?by=${next.by ?? grouping}&period=${next.period ?? preset}`;

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

      {groups.length === 0 ? (
        <p className="mt-8 text-sm opacity-70">
          Nothing invoiced in this period. Work that has been priced but not yet invoiced does
          not appear here — a quote carries no date anybody chose, so there is no honest way to
          count it into a month.
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
    </>
  );
}
