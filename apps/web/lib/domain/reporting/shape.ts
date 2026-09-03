/**
 * What any report is made of, whatever it measures.
 *
 * **Extracted at the second measure and not before.** All of this lived in `financials.ts` while
 * money was the only thing this platform reported on; *work marked complete* is the second, and a
 * grouping, a period and a filter mean the same thing to both. Copying them would be two lists
 * that drift, which is the rule about extracting at the second caller arriving one level up.
 *
 * **D36 predicted this file.** It says a definition holds a grouping, a period and up to three
 * filters *for this report set*, and that the day a set arrives whose fields are not fixed, that
 * record is where the argument for a query language has to be made. This is that day and the
 * argument is not made: the fields stay fixed **per measure**, and what varies is which measure.
 * So a report gains one more column from a closed list, not a builder.
 */

/**
 * What a report can be about.
 *
 * Platform vocabulary, exactly like `CAPABILITIES` and `GROUPINGS`: each entry names something
 * the database actually implements as a function, and adding one means writing the SQL. A
 * business does not invent a measure; it picks one and says how to group it.
 */
export const MEASURES = ['invoiced_and_incurred', 'work_marked_complete'] as const;

export type Measure = (typeof MEASURES)[number];

export const MEASURE_LABELS: Record<Measure, string> = {
  'invoiced_and_incurred': 'Billed and spent',
  // **Marked, and the word is doing work.** `events.occurred_at` records when somebody moved a
  // job into a status their business calls finished, which is not the same instant the work
  // stopped. Saying *completed* would claim a precision this platform does not have, on the same
  // discipline that makes the financial set say invoiced rather than revenue.
  'work_marked_complete': 'Work marked complete',
};

/**
 * What a figure can be grouped by.
 *
 * The tenant's own words appear *inside* a grouping — their customers, their services — never as
 * one of these.
 */
export const GROUPINGS = ['customer', 'service', 'resource', 'location'] as const;

export type Grouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<Grouping, string> = {
  customer: 'Customer',
  service: 'Service',
  resource: 'Resource',
  location: 'Location',
};

/**
 * Which groupings a measure can answer.
 *
 * **Not every measure answers every grouping, and the absences are facts rather than gaps.**
 * Money grouped by service reports no cost, because a cost belongs to a job and a service is one
 * line on it. Completed work has no service grouping at all: a job is finished as a whole, and
 * splitting one completion across the lines on it would be inventing a rule about how — the same
 * refusal, arriving at a count instead of an amount.
 */
export const GROUPINGS_FOR: Record<Measure, readonly Grouping[]> = {
  'invoiced_and_incurred': GROUPINGS,
  'work_marked_complete': ['customer', 'resource', 'location'],
};

/**
 * One entity to narrow to, or none.
 *
 * Three optional ids rather than a filter language, because for these report sets there is
 * nothing else to express (D36). A filter narrows the *jobs* considered, so everything a job
 * contributes is counted together or not at all.
 */
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

/**
 * A period, half-open, as two dates in `YYYY-MM-DD`.
 *
 * Dates rather than instants: every aggregate applies the business's own zone to both ends, from
 * the row that holds it. Both optional — absent means everything on that side.
 */
export type Period = { from?: string; to?: string };

export const PERIODS = ['month', 'year', 'all'] as const;

export type PeriodPreset = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'This month',
  year: 'This year',
  all: 'Everything',
};

/**
 * A preset turned into two dates.
 *
 * **Dates, not instants, and the conversion deliberately does not happen here** (I9). Where a
 * month begins depends on where the business is, and the aggregates apply the tenant's own zone
 * to both ends — once, from the row that holds it. Converting on this side would put the same
 * arithmetic in every caller, and one of those callers is a language model.
 *
 * What this needs the zone for is only *which* month: a tenant in Auckland and one in Montréal
 * are on different dates for most of the server's day, so `today` comes from `todayInZone`.
 *
 * Half-open, matching the aggregates: the first day is included and the last is not, so a month
 * and the month after it share a boundary and count nothing twice.
 */
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
