/**
 * Date/time label formatting shared across Day, Week and Month — every board reads the organization's own timezone the same way, through these, rather than each view picking its own `Intl` options.
 */

export function formatHourLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

export function formatDayHeader(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function formatWeekdayShort(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function formatDayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function formatMonthLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** The period a calendar shows, as one label: a day, a Monday-to-Sunday week, or a month. */
export function formatPeriodLabel(view: 'day' | 'week' | 'month', dates: readonly string[]): string {
  const format = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  if (view === 'month') return formatMonthLabel(dates[Math.floor(dates.length / 2)]);
  if (view === 'day') return format(dates[0], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const first = dates[0], last = dates[dates.length - 1];
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${format(first, { day: 'numeric', month: 'short', year: 'numeric' })} – ${format(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (first.slice(0, 7) !== last.slice(0, 7)) return `${format(first, { day: 'numeric', month: 'short' })} – ${format(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${format(first, { day: 'numeric' })} – ${format(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
