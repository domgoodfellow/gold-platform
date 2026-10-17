import type { Cost } from '@/lib/domain/work-items/consumption';
import { priceWorkItem, type Price, type PricedLine } from '@/lib/domain/pricing/prices';

/** Revenue minus cost, and nothing more — not a report engine (that's the reporting layer). Revenue comes only from `priceWorkItem`; this never totals lines itself. */

/** Deliberately not the shape `priceWorkItem` returns. */
export type Money = { amountMinor: number; currency: string };

export type JobEconomics = {
  /** `Price`, not `Money` — `priceWorkItem`'s answer travels as its own type rather than being restated. */
  revenue: Price;
  /** Per currency, because costs need not share one. */
  costs: Money[];
  /** Null when nothing is priced, nothing is recorded, or the currencies disagree — never a misleading zero. */
  marginMinor: number | null;
  currency: string | null;
};

/** Grouped rather than summed — `work_item_costs.currency` is snapshotted per row, so a business that changed currency has costs in more than one. */
export function totalCost(costs: Cost[]): Money[] {
  const byCurrency = new Map<string, number>();

  for (const cost of costs) {
    byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0) + cost.amountMinor);
  }

  return [...byCurrency.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Pure — takes what the caller already read rather than querying again. */
export function jobEconomics(input: { lines: PricedLine[]; costs: Cost[] }): JobEconomics {
  const revenue = priceWorkItem(input.lines);
  const costs = totalCost(input.costs);

  // A job with no costs recorded has margin equal to revenue — true, not optimistic.
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
