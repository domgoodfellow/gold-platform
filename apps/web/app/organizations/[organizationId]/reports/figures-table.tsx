import {
  GROUPING_LABELS,
  totalsByCurrency,
  type FinancialGroup,
  type Grouping,
} from '@/lib/domain/reporting/financials';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * A set of figures, drawn.
 *
 * Extracted at the second caller and not before: the ad-hoc view had it inline until a dashboard
 * needed the same table for each of its tiles. It renders and totals and decides nothing —
 * `totalsByCurrency` is the domain function, for the reason I4 gives about inline sums.
 *
 * Three absences are deliberate and each is a rule rather than a gap. A dash where a cost or a
 * margin would be means the question is not defined for this grouping, never that it came to
 * zero. *Not attributed* is application state describing a row with nothing recorded in that
 * column, and it is the platform's own word rather than one put in the business's mouth. And a
 * business trading in two currencies gets two totals, because a rate has a date.
 */
export function FiguresTable({
  groups,
  grouping,
}: {
  groups: FinancialGroup[];
  grouping: Grouping;
}) {
  const totals = totalsByCurrency(groups);

  return (
    <div className="overflow-x-auto">
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
  );
}
