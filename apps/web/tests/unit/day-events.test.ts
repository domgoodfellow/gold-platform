import { describe, expect, it } from 'vitest';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { dayEvents } from '@/features/scheduling/calendar/day-events';

/**
 * Day shows a work item in every lane it takes part in; Week and Month are not lanes, so they read
 * the same projection once per work item. One job with three resources must never become three
 * entries — or three jobs on a count.
 */

const window = { startsAt: '2027-04-05T10:00:00.000Z', endsAt: '2027-04-05T11:00:00.000Z' };
const within = { startsAt: '2027-04-05T00:00:00.000Z', endsAt: '2027-04-06T00:00:00.000Z' };

function lane(id: string, name: string, workItemIds: string[]) {
  return {
    resource: { id, name },
    free: [],
    open: [],
    exceptions: [],
    booked: workItemIds.map((workItemId) => ({
      workItemId,
      title: `Job ${workItemId}`,
      window,
      occupied: window,
      resourceIds: ['alex', 'van'],
      typeId: 'type',
      availabilityProblem: null,
    })),
  };
}

const day: ScheduleDay = {
  date: '2027-04-05',
  within,
  open: [],
  resources: [lane('alex', 'Alex', ['one']), lane('van', 'Service Van 1', ['one']), lane('machine', 'Tire Machine', ['two'])],
  unassigned: [{ workItemId: 'three', typeId: 'type', title: 'Job three', window: { startsAt: '2027-04-05T13:00:00.000Z', endsAt: '2027-04-05T14:00:00.000Z' } }],
};

describe('dayEvents', () => {
  it('lists a multi-resource work item once, with everyone on it', () => {
    const events = dayEvents(day);
    expect(events.map((event) => event.workItemId)).toEqual(['one', 'two', 'three']);
    expect(events[0].resourceNames).toEqual(['Alex', 'Service Van 1']);
  });

  it('keeps scheduled work nobody is on, with no names', () => {
    expect(dayEvents(day).find((event) => event.workItemId === 'three')?.resourceNames).toEqual([]);
  });
});
