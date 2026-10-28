import type { ChartData } from '@/lib/chart-model';
import type { WidgetDefinition } from '@/lib/dashboard-layout';
import type { WorkOperations } from './operations';

/**
 * Work Dashboard widgets in the default reading order: Work overview, Needs attention beside the
 * selected day, scheduled-work volume beside dispatch capacity, then Upcoming and recent activity.
 * The layout is the product default for everyone: personal Work layouts need the preference table to
 * accept a Work workspace, which it does not yet, so no Customize control is offered.
 */
export const WORK_WIDGETS = [
  { id: 'overview', label: 'Work overview', spans: [12], defaultSpan: 12, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'attention', label: 'Needs attention', spans: [6, 8, 12], defaultSpan: 8, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'today', label: 'Selected day', spans: [4, 6, 12], defaultSpan: 4, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'volume', label: 'Scheduled work', spans: [6, 8, 12], defaultSpan: 6, heights: ['compact', 'standard'], defaultHeight: 'compact', presentations: ['bar', 'line', 'table'], hideable: true },
  { id: 'capacity', label: 'Dispatch capacity', spans: [6, 12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', hideable: true },
  { id: 'upcoming', label: 'Upcoming', spans: [6, 12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', hideable: true },
  { id: 'activity', label: 'Recent activity', spans: [6, 12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', hideable: true },
] as const satisfies readonly WidgetDefinition[];

export type WorkWidgetId = (typeof WORK_WIDGETS)[number]['id'];

/**
 * What a business still needs before its Dashboard has anything to show, in the order it is
 * needed: a type, then a starting stage for it, then a first work item. Resources are a step only
 * when some ready type is scheduled — work that never occupies time never asks for one — and only
 * once there is work, where the capacity panel says so in place.
 */
export type WorkSetupStep =
  | { kind: 'no-types' }
  | { kind: 'no-starting-stage'; typeId: string; typeName: string }
  | { kind: 'no-work'; typeId: string }
  | null;

export function workSetupStep(data: Pick<WorkOperations, 'setup' | 'recorded'>): WorkSetupStep {
  const { types } = data.setup;
  if (!types.length) return { kind: 'no-types' };
  const ready = types.filter(type => type.ready);
  if (!ready.length) return { kind: 'no-starting-stage', typeId: types[0].id, typeName: types[0].name };
  if (!data.recorded) return { kind: 'no-work', typeId: ready[0].id };
  return null;
}

/** Whether any ready type is scheduled; without one, scheduling measures and capacity mean nothing here. */
export function schedulesWork(data: Pick<WorkOperations, 'setup'>): boolean {
  return data.setup.types.some(type => type.ready && type.schedulable);
}

/**
 * Which widgets have something truthful to show. Before the first work item only the overview (with
 * its setup step) is drawn; scheduling widgets need a ready type that is scheduled.
 */
export function readableWorkWidgets(data: Pick<WorkOperations, 'setup' | 'recorded'>): Set<WorkWidgetId> {
  if (workSetupStep(data)) return new Set(['overview']);
  return new Set<WorkWidgetId>(['overview', ...(schedulesWork(data) ? ['attention', 'today', 'volume', 'capacity', 'upcoming'] as const : []), 'activity']);
}

const dayLabel = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
const shortDay = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));

/**
 * Committed work per day for the seven days ending on the selected day, from `workOperations`'
 * `history` (the canonical scheduling projection; released work excluded). Each day links to that
 * day's schedule. No second count is made here.
 */
export function scheduledVolumeChart(history: WorkOperations['history'], selected: string, dayHref: (day: string) => string): ChartData {
  return {
    shape: 'time-series', format: { kind: 'number', unit: 'jobs' }, categoryLabel: 'Day',
    period: `Seven days ending ${shortDay(selected)}`,
    categories: history.map(day => ({ key: day.date, label: dayLabel(day.date), short: shortDay(day.date), at: day.date, href: dayHref(day.date) })),
    series: [{ id: 'scheduled', label: 'Scheduled work', points: history.map(day => ({ value: day.count, label: `${day.count} ${day.count === 1 ? 'job' : 'jobs'}` })) }],
  };
}
