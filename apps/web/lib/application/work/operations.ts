import type { Db } from '@/lib/db/types';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { listScheduleDays, type ScheduleDay } from '@/lib/domain/scheduling/availability';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { coverageView, evaluateWorkItems } from '@/lib/domain/work-items/requirements';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { zonedDayRange, shiftDate } from '@/lib/domain/scheduling/window';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listResources } from '@/lib/domain/resources/resources';

export function scheduledIds(day: ScheduleDay): string[] {
  return [...new Set([...day.resources.flatMap(r => r.booked.map(b => b.workItemId)), ...day.unassigned.map(w => w.workItemId)])];
}

/**
 * The Work Dashboard's read model for one selected day in the organization's zone. Selected-day
 * figures (scheduled, requirement gaps, availability conflicts) come from the canonical scheduling
 * projection; the unassigned and unscheduled backlogs span all dates; upcoming is the seven days
 * after the selected day, so no job is listed under both. `setup` names what a business still lacks
 * (types, starting stages, resources) from the same domain reads the configuration pages use.
 */
export async function workOperations(db: Db, organizationId: string, date: string, timezone: string) {
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 6));
  const [days, hours, unassigned, unscheduled, upcoming, active, recorded, types, resources] = await Promise.all([
    listScheduleDays(db, { organizationId, dates, timeZone: timezone }),
    listOperatingHours(db, { organizationId }),
    listWorkItems(db, { organizationId, active: true, scheduled: true, unassigned: true, limit: 6 }),
    listWorkItems(db, { organizationId, active: true, scheduled: false, limit: 6 }),
    listWorkItems(db, { organizationId, active: true, within: { startsAt: zonedDayRange(shiftDate(date, 1), timezone).startsAt, endsAt: zonedDayRange(shiftDate(date, 8), timezone).startsAt }, sort: 'schedule', limit: 6 }),
    listWorkItems(db, { organizationId, active: true, limit: 1 }),
    listWorkItems(db, { organizationId, limit: 1 }),
    listWorkItemTypes(db, { organizationId }),
    listResources(db, { organizationId, limit: 1 }),
  ]);
  const stages = await Promise.all(types.map(type => listWorkItemStatuses(db, { organizationId, typeId: type.id })));
  const setup = { types: types.map((type, i) => ({ ...type, ready: stages[i].length > 0 })), resources: resources.total };
  const day = days[6];
  const ids = scheduledIds(day);
  const records = await listWorkItems(db, { organizationId, ids, limit: 5, sort: 'schedule' });
  const scheduled = new Map<string, { workItemId: string; typeId: string; resourceIds: string[] }>();
  for (const lane of day.resources) for (const b of lane.booked) scheduled.set(b.workItemId, b);
  for (const b of day.unassigned) scheduled.set(b.workItemId, { ...b, resourceIds: [] });
  const evaluated = await evaluateWorkItems(db, { organizationId, items: [...scheduled.values()] });
  const coverage = Object.fromEntries([...evaluated].map(([id, e]) => [id, coverageView(e, RESOURCE_CLASS_LABELS)]));
  const shortfallIds = [...evaluated].filter(([, e]) => !e.satisfied).map(([id]) => id);
  const conflictIds = [...new Set(day.resources.flatMap(r => r.booked.filter(b => b.availabilityProblem).map(b => b.workItemId)))];
  const [shortfalls, conflicts] = await Promise.all([
    listWorkItems(db, { organizationId, ids: shortfallIds, limit: 6 }),
    listWorkItems(db, { organizationId, ids: conflictIds, limit: 6 }),
  ]);
  const minutes = (windows: { startsAt: string; endsAt: string }[]) => windows.reduce((sum, w) => sum + (Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 60000, 0);
  return { date, setup, day, hoursConfigured: hours.length > 0, unassigned, unscheduled, upcoming, active: active.total, recorded: recorded.total,
    today: records, todayCount: ids.length, coverage, shortfalls, conflicts,
    available: day.resources.filter(r => r.free.length > 0).length,
    freeHours: day.resources.reduce((sum, r) => sum + minutes(r.free) / 60, 0),
    openHours: day.resources.reduce((sum, r) => sum + minutes(r.open) / 60, 0),
    history: days.map(d => ({ date: d.date, count: scheduledIds(d).length })),
  };
}
export type WorkOperations = Awaited<ReturnType<typeof workOperations>>;
export type WorkPreview = WorkItem[];
