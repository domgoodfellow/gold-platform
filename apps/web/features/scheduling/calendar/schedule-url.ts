import { calendarHref, type CalendarView } from '@/components/calendar/calendar-workspace';
export { parseCalendarView as parseScheduleView, parseCalendarDate as parseScheduleDate } from '@/components/calendar/calendar-period';
export type ScheduleView = CalendarView;
type QueryValue = string | readonly string[] | undefined;

/** Absent entirely: no filter, which is what "show every resource" means. */
export function parseScheduleResourceIds(raw: QueryValue): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? [...raw] : [raw as string];
}

/**
 * The one way to spell a `/schedule` address that keeps all three facts. `resourceIds` empty
 * means "every resource" and is written as no `resource` parameter at all, never an empty one —
 * the same convention `parseScheduleResourceIds` reads back.
 */
export function scheduleHref(
  organizationId: string,
  state: { view: ScheduleView; date: string; resourceIds: readonly string[] },
): string {
  return calendarHref(`/organizations/${organizationId}/schedule`, state.view, state.date, { resource: state.resourceIds });
}
