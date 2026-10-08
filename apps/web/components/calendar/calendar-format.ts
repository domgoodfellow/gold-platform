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
