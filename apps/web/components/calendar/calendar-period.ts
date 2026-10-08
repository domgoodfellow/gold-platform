import { isoDayOfWeek, shiftDate, startOfMonth } from '@/lib/domain/scheduling/window';
import type { CalendarView } from './calendar-workspace';

type QueryValue = string | readonly string[] | undefined;

export function parseCalendarView(raw: QueryValue): CalendarView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'week' || value === 'month' ? value : 'day';
}

export function parseCalendarDate(raw: QueryValue, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value ? value : fallback;
}

export function calendarDates(view: CalendarView, date: string): string[] {
  const anchor = view === 'month' ? startOfMonth(date) : date;
  const first = view === 'day' ? date : shiftDate(anchor, 1 - isoDayOfWeek(anchor));
  return Array.from({ length: view === 'month' ? 42 : view === 'week' ? 7 : 1 }, (_, index) => shiftDate(first, index));
}
