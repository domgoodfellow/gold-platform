import type { Cost } from '@/lib/domain/work-items/consumption';
import { priceWorkItem, type Price, type PricedLine } from '@/lib/domain/pricing/prices';

/**
 * What a job earned, what it consumed, and the difference.
 *
 * `roadmap.md`: "Prices landed in M3 and costs in M2, and nothing subtracts them. Revenue
 * minus cost per job is the smallest useful version, and it is the number the owner asks for
 * first." This is that subtraction and nothing more — not a report engine, not a dashboard,
 * and not an aggregate layer, which is M7 and has its own milestone for good reasons.
 *
 * **Revenue is `priceWorkItem` and nothing else** (I4). This module does not total lines; it
 * calls the one function that may, exactly as every screen does. **Cost is `totalCost` below,
 * which is new**, and it is a function rather than an inline `reduce` for the same reason I4
 * gives about prices: a total looks like formatting until the day something conditions it,
 * and then every inline sum is a place the rule was forgotten.
 *
 * **Margin is only defined when the two currencies agree, and refusing to invent one is the
 * whole design.** A cost snapshots the currency it was recorded in and a priced line
 * snapshots the currency it was quoted in (I8, I10) — so a business that changed what it
 * trades in genuinely has a job whose revenue is in one currency and whose costs are in two.
 * Converting them would need a rate, a rate has a date, and a date makes this an accounting
 * system, which `vision.md` refuses to be in as many words. So the answer is two numbers and
 * an honest `null`, and the screen says why.
 */

/** A cost total in one currency. Deliberately not the shape `priceWorkItem` returns. */
export type Money = { amountMinor: number; currency: string };

export type JobEconomics = {
  /**
   * What the job is quoted, straight from the one price calculation and unreshaped.
   *
   * `Price` rather than `Money`, and the difference is not an oversight: I4 says
   * `priceWorkItem` is the only place an amount is derived, so its answer travels as its own
   * type. Restating it here would be a second declaration of what a price is, and the first
   * thing to diverge would be whatever a later pricing rule adds to it.
   */
  revenue: Price;
  /** What it consumed, per currency, because costs need not share one. */
  costs: Money[];
  /**
   * Revenue minus cost, or null when that subtraction is not defined.
   *
   * Null has three distinct causes and the screen distinguishes them: nothing is priced,
   * nothing is recorded, or the currencies disagree. A zero here would claim the job broke
   * even, which is a different and much stronger statement than "we cannot say".
   */
  marginMinor: number | null;
  /** The currency `marginMinor` is in, when there is one. */
  currency: string | null;
};

/**
 * What a job consumed, totalled per currency.
 *
 * Grouped rather than summed into one number because `work_item_costs.currency` is
 * snapshotted per row: a business that changed what it trades in has older costs in the old
 * currency, and adding them together would produce a figure in no currency at all.
 */
export function totalCost(costs: Cost[]): Money[] {
  const byCurrency = new Map<string, number>();

  for (const cost of costs) {
    byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0) + cost.amountMinor);
  }

  return [...byCurrency.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The economics of one job.
 *
 * Pure, and takes what the callers have already read rather than reading anything itself —
 * the work item screen holds both lists for its own sections, so a version of this that
 * queried would be two round trips for numbers already on the page.
 */
export function jobEconomics(input: { lines: PricedLine[]; costs: Cost[] }): JobEconomics {
  const revenue = priceWorkItem(input.lines);
  const costs = totalCost(input.costs);

  // Defined only when there is a price, and every cost is in that same currency. A job with
  // no costs recorded yet has a margin equal to its revenue, which is true rather than
  // optimistic: nothing has been spent on it that this business has written down.
  const comparable =
    revenue !== null && costs.every((cost) => cost.currency === revenue.currency);

  if (!comparable || revenue === null) {
    return { revenue, costs, marginMinor: null, currency: null };
  }

  const spent = costs.reduce((total, cost) => total + cost.amountMinor, 0);

  return {
    revenue,
    costs,
    marginMinor: revenue.totalMinor - spent,
    currency: revenue.currency,
  };
}
