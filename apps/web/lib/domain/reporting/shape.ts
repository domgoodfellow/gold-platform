/**
 * What any report is made of, whatever it measures. Fields stay fixed per measure —
 * a report gains a column from a closed list, not a query builder.
 */

/** Platform vocabulary — each entry names a function the database actually implements. */
export const MEASURES = [
  'invoiced_and_incurred',
  'work_marked_complete',
  'time_committed',
] as const;

export type Measure = (typeof MEASURES)[number];

export const MEASURE_LABELS: Record<Measure, string> = {
  'invoiced_and_incurred': 'Billed and spent',
  /** "Marked" rather than "completed" — `occurred_at` records when a status changed, not when the work stopped. */
  'work_marked_complete': 'Work marked complete',
  /** The numerator of utilisation, not a percentage — a percentage needs `freeWindows`, the one availability calculation. */
  'time_committed': 'Time committed',
};

/** A tenant's own words (customers, services) live inside a grouping, never as one of these. */
export const GROUPINGS = ['customer', 'service', 'resource', 'location'] as const;

export type Grouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<Grouping, string> = {
  customer: 'Customer',
  service: 'Service',
  resource: 'Resource',
  location: 'Location',
};

/** Absences are facts, not gaps — e.g. money grouped by service reports no cost, because a cost belongs to a job and a service is one line on it. */
export const GROUPINGS_FOR: Record<Measure, readonly Grouping[]> = {
  'invoiced_and_incurred': GROUPINGS,
  'work_marked_complete': ['customer', 'resource', 'location'],
  'time_committed': ['customer', 'resource', 'location'],
};

/** Three optional ids rather than a filter language — nothing else needs expressing for these report sets. */
export type Filters = {
  customerId?: string | null;
  resourceId?: string | null;
  locationId?: string | null;
};

export const FILTER_LABELS: Record<keyof Filters, string> = {
  customerId: 'Customer',
  resourceId: 'Resource',
  locationId: 'Location',
};

/** Dates, not instants — every aggregate applies the business's own zone to both ends. Both optional; absent means everything on that side. */
export type Period = { from?: string; to?: string };

export const PERIODS = ['month', 'year', 'all'] as const;

export type PeriodPreset = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'This month',
  year: 'This year',
  all: 'Everything',
};

/** Half-open (first day included, last excluded) so consecutive periods share a boundary without double-counting. */
export function periodFor(preset: PeriodPreset, today: string): Period {
  if (preset === 'all') return {};

  const [year, month] = today.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');

  if (preset === 'year') {
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }

  return {
    from: `${year}-${pad(month)}-01`,
    to: month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`,
  };
}
