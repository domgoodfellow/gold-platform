/**
 * The one place `/schedule`'s query string is read and written. Every control that changes view,
 * date or resource filters (`ScheduleViewNav`, `ScheduleToolbar`, `ScheduleResourceFilter`, and
 * the route itself) goes through these, so the URL stays the single source of truth for all
 * three facts at once rather than one control silently dropping what another had set.
 */

export type ScheduleView = 'day' | 'week' | 'month';

type QueryValue = string | readonly string[] | undefined;

const VIEWS: readonly ScheduleView[] = ['day', 'week', 'month'];

/** Missing or unrecognised resolves to Day — never a 404 for a mistyped query string. */
export function parseScheduleView(raw: QueryValue): ScheduleView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return VIEWS.includes(value as ScheduleView) ? (value as ScheduleView) : 'day';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Missing or invalid resolves to the caller's own fallback — today in the organization's timezone. */
export function parseScheduleDate(raw: QueryValue, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && DATE.test(value) ? value : fallback;
}

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
  const params = new URLSearchParams();
  params.set('view', state.view);
  params.set('on', state.date);
  for (const id of state.resourceIds) params.append('resource', id);
  return `/organizations/${organizationId}/schedule?${params.toString()}`;
}
