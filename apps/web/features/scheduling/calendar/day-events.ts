import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { availabilityNote } from './availability-note';
import { clipWindow, type Window } from '@/lib/domain/scheduling/window';

/**
 * One scheduled work item as a day-level view draws it: **once**, however many resources are on it.
 * Day shows a work item in each lane it takes part in because a lane is a resource; Week and Month
 * are not lanes, so they read the same `ScheduleDay` through this and a job with three people and a
 * van is one entry that says who. Nothing here is stored — it is the same projection, de-duplicated
 * by the work item's own id.
 */
export type DayEvent = {
  workItemId: string;
  title: string;
  window: Window;
  /** The appointment clipped to this tenant calendar day, for geometry and sorting only. */
  displayWindow: Window;
  /** Who is on it, by name. Empty means scheduled with nobody assigned. */
  resourceNames: string[];
  /** Set when any resource on it no longer works then — flagged on the entry, never a reason to drop it. */
  availabilityNote?: string;
};

export function dayEvents(day: ScheduleDay): DayEvent[] {
  const byWorkItem = new Map<string, DayEvent>();

  for (const entry of day.resources) {
    for (const booking of entry.booked) {
      const note = availabilityNote(booking.availabilityProblem, entry.resource.name);
      const existing = byWorkItem.get(booking.workItemId);
      if (existing) {
        existing.resourceNames.push(entry.resource.name);
        existing.availabilityNote ??= note;
        continue;
      }
      byWorkItem.set(booking.workItemId, {
        workItemId: booking.workItemId,
        title: booking.title,
        window: booking.window,
        // A booking that spans midnight is clipped to this day, or it would sort and read by the
        // previous day's start even on the day it only continues into.
        displayWindow: clipWindow(booking.window, day.within) ?? booking.window,
        resourceNames: [entry.resource.name],
        availabilityNote: note,
      });
    }
  }

  for (const work of day.unassigned) {
    byWorkItem.set(work.workItemId, {
      workItemId: work.workItemId,
      title: work.title,
      window: work.window,
      displayWindow: clipWindow(work.window, day.within) ?? work.window,
      resourceNames: [],
    });
  }

  return [...byWorkItem.values()].sort((a, b) => a.displayWindow.startsAt.localeCompare(b.displayWindow.startsAt));
}
