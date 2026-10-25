/**
 * The data contract every shared chart reads, and the pure rules over it. Nothing here queries,
 * aggregates or converts: server-side application code supplies authorized values, already
 * labelled. A value's `label` is its exact display text (for money, the domain's own formatter
 * produced it); `value` is only geometry. Axis ticks are scale positions, not stored amounts, so
 * they are the one thing formatted here.
 */

/** What the numbers are, which decides the presentations that can show them truthfully. */
export type ChartShape =
  /** Values over ordered dates or periods. */
  | 'time-series'
  /** Independent totals by category (aging bands, statuses). */
  | 'categorical'
  /** Non-negative parts of one whole. */
  | 'composition';

export type ChartPresentation = 'line' | 'bar' | 'horizontal-bar' | 'stacked-bar' | 'donut' | 'table';

/** How tick values on an axis are written. Money is one currency per chart, never mixed. */
export type ChartValueFormat =
  | { kind: 'money'; currency: string }
  | { kind: 'number'; unit?: string; precision?: number }
  | { kind: 'percent'; precision?: number };

export type ChartPoint = {
  /** Geometry only (money in integer minor units). `null` is unknown, never zero. */
  value: number | null;
  /** The exact text a person reads for this value, e.g. "CA$1,250.00" or "Unknown". */
  label: string;
};

export type ChartSeries = { id: string; label: string; points: ChartPoint[] };

export type ChartCategory = {
  key: string;
  /** Full label, used in tooltips and the table. */
  label: string;
  /** Short axis label for narrow space; defaults to `label`. */
  short?: string;
  /** An authorized destination for this category, already checked by the server. */
  href?: string;
  /** ISO date for a time series; when every category has one, positions follow real time. */
  at?: string;
};

export type ChartData = {
  shape: ChartShape;
  categories: ChartCategory[];
  series: ChartSeries[];
  format: ChartValueFormat;
  /** What the figures cover, e.g. "October 2026" or "Current, as of today". Always shown. */
  period: string;
  /** Category column heading in the table, e.g. "Day" or "Age band". */
  categoryLabel: string;
};

export type ChartState =
  | { status: 'ready' }
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'unavailable'; message: string };

/** The presentations a shape may use. Every list ends with Table, which is always truthful. */
const BY_SHAPE: Record<ChartShape, readonly ChartPresentation[]> = {
  'time-series': ['line', 'bar', 'table'],
  categorical: ['horizontal-bar', 'bar', 'table'],
  composition: ['stacked-bar', 'donut', 'table'],
};

export const PRESENTATION_LABEL: Record<ChartPresentation, string> = {
  line: 'Line', bar: 'Vertical bars', 'horizontal-bar': 'Horizontal bars', 'stacked-bar': 'Stacked bars', donut: 'Donut', table: 'Table',
};

/**
 * Presentations that show these values without distorting them. A donut needs one series of
 * known, non-negative parts with something to divide; a stack needs non-negative parts. Line and
 * bar are only for values that have an order (time) or independent categories.
 */
export function allowedPresentations(data: Pick<ChartData, 'shape' | 'series'>): ChartPresentation[] {
  const values = data.series.flatMap(series => series.points.map(point => point.value));
  const negative = values.some(value => value !== null && value < 0);
  const unknown = values.some(value => value === null);
  return BY_SHAPE[data.shape].filter(presentation => {
    if (presentation === 'donut') return data.series.length === 1 && !negative && !unknown && values.some(value => (value ?? 0) > 0);
    if (presentation === 'stacked-bar') return !negative;
    return true;
  });
}

/** The requested presentation when it is valid for the data, otherwise the shape's first valid one. */
export function resolvePresentation(data: Pick<ChartData, 'shape' | 'series'>, requested?: string | null): ChartPresentation {
  const allowed = allowedPresentations(data);
  return allowed.includes(requested as ChartPresentation) ? requested as ChartPresentation : allowed[0];
}

/** Whether there is anything to draw: at least one known value. Zeroes count — zero is a fact. */
export function hasValues(data: Pick<ChartData, 'series'>): boolean {
  return data.series.some(series => series.points.some(point => point.value !== null));
}

/** Rounded tick positions covering [min, max], always including zero, about `count` of them. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const low = Math.min(0, min), high = Math.max(0, max);
  if (low === high) return [0, 1];
  const raw = (high - low) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw) ?? 10 * magnitude;
  const start = Math.floor(low / step) * step, end = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(Math.round(tick / step) * step);
  return ticks;
}

/** Maps a domain onto a pixel range. */
export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain, [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** How many category labels fit along an axis, so ticks thin out rather than overlap. */
export function labelStride(categories: number, width: number, minLabelWidth = 64): number {
  return Math.max(1, Math.ceil(categories / Math.max(1, Math.floor(width / minLabelWidth))));
}

/** Writes an axis tick. Money ticks are scale positions in minor units, written compactly in the chart's one currency. */
export function formatTick(value: number, format: ChartValueFormat): string {
  if (format.kind === 'money') {
    let digits = 2;
    try { digits = new Intl.NumberFormat('en-GB', { style: 'currency', currency: format.currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* unknown to ICU */ }
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: format.currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value / 10 ** digits); } catch { return `${value / 10 ** digits} ${format.currency}`; }
  }
  if (format.kind === 'percent') return `${value.toFixed(format.precision ?? 0)}%`;
  const text = new Intl.NumberFormat('en-GB', { notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: format.precision ?? 1 }).format(value);
  return format.unit ? `${text} ${format.unit}` : text;
}

/** The domain's own words for a format, used in titles and the table caption. */
export function describeFormat(format: ChartValueFormat): string {
  return format.kind === 'money' ? format.currency : format.kind === 'percent' ? 'percent' : format.unit ?? 'count';
}

/** Series colours: the organization palette first, then neutral foreground tones. Distinguished by marker and dash too, never by colour alone. */
// The theme-adjusted "indicator"/"text" variants, which `brandTokens` keeps readable in light and dark.
export const SERIES_COLORS = ['var(--accent-indicator, var(--accent))', 'var(--brand-secondary-text, var(--muted))', 'var(--brand-highlight-indicator, var(--foreground))', 'var(--foreground)', 'var(--muted)'] as const;
export const SERIES_DASHES = ['', '6 4', '2 3', '10 3 2 3', '1 5'] as const;
export const seriesColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];
export const seriesDash = (index: number) => SERIES_DASHES[index % SERIES_DASHES.length];
