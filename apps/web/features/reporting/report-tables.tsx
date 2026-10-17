import { TableCell, TableHeaderCell, TableScroll } from '@/components/display/table';
import {
  formatMinutes,
  totalMinutes,
  type CommitmentGroup,
} from '@/lib/domain/reporting/commitment';
import { totalJobs, type CompletionGroup } from '@/lib/domain/reporting/completion';
import { totalsByCurrency, type FinancialGroup } from '@/lib/domain/reporting/financials';
import { GROUPING_LABELS, type Grouping } from '@/lib/domain/reporting/shape';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * The tables a report can be drawn as — one per measure.
 *
 * Extracted at the second caller and not before: the ad-hoc view had them inline until a
 * dashboard needed the same table for each of its tiles. They render and total and decide
 * nothing — `totalsByCurrency` and `totalJobs` are the domain functions, for the reason the one-calculation rule gives
 * about inline sums.
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
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <TableHeaderCell>{GROUPING_LABELS[grouping]}</TableHeaderCell>
            <TableHeaderCell numeric>Invoiced</TableHeaderCell>
            <TableHeaderCell numeric>Incurred</TableHeaderCell>
            <TableHeaderCell numeric className="pr-0">Margin</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr
              key={`${group.groupId ?? group.label ?? 'none'}-${group.currency}`}
              className="border-b border-border/50"
            >
              <TableCell>
                {group.label ?? <span className="text-muted">Not attributed</span>}
              </TableCell>
              <TableCell numeric>
                {formatMoney(group.invoicedMinor, group.currency)}
              </TableCell>
              <TableCell numeric>
                {group.incurredMinor === null
                  ? '—'
                  : formatMoney(group.incurredMinor, group.currency)}
              </TableCell>
              <TableCell numeric className="pr-0">
                {group.marginMinor === null
                  ? '—'
                  : formatMoney(group.marginMinor, group.currency)}
              </TableCell>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map((total) => (
            <tr key={total.currency} className="font-medium">
              <TableCell>Total ({total.currency})</TableCell>
              <TableCell numeric>
                {formatMoney(total.invoicedMinor, total.currency)}
              </TableCell>
              <TableCell numeric>
                {total.incurredMinor === null
                  ? '—'
                  : formatMoney(total.incurredMinor, total.currency)}
              </TableCell>
              <TableCell numeric className="pr-0">
                {total.marginMinor === null
                  ? '—'
                  : formatMoney(total.marginMinor, total.currency)}
              </TableCell>
            </tr>
          ))}
        </tfoot>
      </table>
    </TableScroll>
  );
}

/**
 * How many jobs a business marked finished, drawn.
 *
 * A count has no currency, so this has one total rather than a set. **Not attributed** is the
 * platform describing a row with nothing recorded in that column, which is application state
 * rather than a word put in the business's mouth.
 */
export function JobsTable({
  groups,
  grouping,
}: {
  groups: CompletionGroup[];
  grouping: Grouping;
}) {
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <TableHeaderCell>{GROUPING_LABELS[grouping]}</TableHeaderCell>
            <TableHeaderCell numeric className="pr-0">Jobs marked complete</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr
              key={group.groupId ?? group.label ?? 'none'}
              className="border-b border-border/50"
            >
              <TableCell>
                {group.label ?? <span className="text-muted">Not attributed</span>}
              </TableCell>
              <TableCell numeric className="pr-0">{group.jobs}</TableCell>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <TableCell>Total</TableCell>
            <TableCell numeric className="pr-0">{totalJobs(groups)}</TableCell>
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  );
}

/**
 * How much resource time a business committed, drawn.
 *
 * One total rather than a set, because a duration has no currency. `formatMinutes` is the one
 * place minutes become words — hours and minutes rather than decimal hours, because *7h 30m* is
 * what a timesheet reads like and 7.5 invites being multiplied by a rate.
 */
export function CommittedTimeTable({
  groups,
  grouping,
}: {
  groups: CommitmentGroup[];
  grouping: Grouping;
}) {
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <TableHeaderCell>{GROUPING_LABELS[grouping]}</TableHeaderCell>
            <TableHeaderCell numeric className="pr-0">Time committed</TableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr
              key={group.groupId ?? group.label ?? 'none'}
              className="border-b border-border/50"
            >
              <TableCell>
                {group.label ?? <span className="text-muted">Not attributed</span>}
              </TableCell>
              <TableCell numeric className="pr-0">{formatMinutes(group.minutes)}</TableCell>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <TableCell>Total</TableCell>
            <TableCell numeric className="pr-0">{formatMinutes(totalMinutes(groups))}</TableCell>
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  );
}
