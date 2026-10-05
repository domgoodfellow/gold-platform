import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { parseWindow, zonedDayRange, zonedTimeToInstant, type Window } from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * When a resource works, and when it does not.
 *
 *   open = organization hours ∩ resource working hours − resource exceptions
 *   free = open − commitments                      (`freeWindows`, in availability.ts)
 *
 * The first line is computed once, in the database (`app.resource_open_windows`), because the
 * refusal of a booking outside those hours must read the same answer the screen drew. This file
 * reads it, and writes the two things that feed it. It does not subtract commitments and it does
 * not decide eligibility — those are `freeWindows` and the work type's requirements.
 *
 * A resource with no working hours of its own **inherits the organization's**. Having none says
 * nothing; it is never read as "never works".
 */

/** One working period on one weekday, as the tenant reads it. Wall-clock, not an instant. */
export type WorkingPeriod = {
  /** ISO 8601: 1 is Monday through 7 is Sunday. */
  dayOfWeek: number;
  /** `HH:MM:SS` in the organization's zone. */
  opensAt: string;
  closesAt: string;
};

export type ResourceWorkingHours =
  | { mode: 'inherit' }
  /** An empty list is a resource that never works — a statement somebody made. */
  | { mode: 'custom'; periods: (WorkingPeriod & { id: string })[] };

export type ResourceAvailabilityException = {
  id: string;
  resourceId: string;
  window: Window;
  kind: 'unavailable';
  /** The business's own word for it. Never interpreted. */
  reason: string | null;
};

/** Why scheduled work no longer fits its resource. Derived on every read; never stored. */
export type AvailabilityProblem = 'outside_hours' | 'unavailable';

export type AvailabilityConflict = {
  workItemId: string;
  resourceId: string;
  problem: AvailabilityProblem;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

function normaliseTime(value: string, field: string): string {
  const match = TIME.exec(value.trim());
  if (!match) {
    throw new DomainError(`${field} must be a time of day, such as 09:00.`, 'resource_hours.time_invalid');
  }
  return `${match[1]}:${match[2]}:${match[4] ?? '00'}`;
}

/** Validated and normalised; the database re-checks overlap and ordering, and this produces the sentence. */
export function validateWorkingPeriods(periods: WorkingPeriod[]): WorkingPeriod[] {
  const checked = periods.map((period) => {
    if (!Number.isInteger(period.dayOfWeek) || period.dayOfWeek < 1 || period.dayOfWeek > 7) {
      throw new DomainError('A day is a number from 1 (Monday) to 7 (Sunday).', 'resource_hours.day_invalid');
    }
    const opensAt = normaliseTime(period.opensAt, 'Start time');
    const closesAt = normaliseTime(period.closesAt, 'End time');
    if (closesAt <= opensAt) {
      throw new DomainError(
        'End time must be after start time. A shift that runs past midnight is two periods.',
        'resource_hours.closes_before_opens',
      );
    }
    return { dayOfWeek: period.dayOfWeek, opensAt, closesAt };
  });

  const ordered = [...checked].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    // Half-open: one period ending when the next begins is a split shift, not an overlap.
    if (previous.dayOfWeek === current.dayOfWeek && current.opensAt < previous.closesAt) {
      throw new DomainError('Two working periods on the same day overlap.', 'resource_hours.overlap');
    }
  }
  return ordered;
}

export async function getResourceWorkingHours(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<ResourceWorkingHours> {
  const [schedule, hours] = await Promise.all([
    db
      .from('resource_working_schedules')
      .select('resource_id')
      .eq('organization_id', input.organizationId)
      .eq('resource_id', input.resourceId)
      .maybeSingle(),
    db
      .from('resource_working_hours')
      .select('id, day_of_week, opens_at, closes_at')
      .eq('organization_id', input.organizationId)
      .eq('resource_id', input.resourceId)
      .order('day_of_week', { ascending: true })
      .order('opens_at', { ascending: true }),
  ]);

  if (schedule.error) throw new DomainError(schedule.error.message, 'resource_hours.read_failed');
  if (hours.error) throw new DomainError(hours.error.message, 'resource_hours.read_failed');

  // The mode is the schedule row, never the presence of hours rows.
  if (!schedule.data) return { mode: 'inherit' };

  return {
    mode: 'custom',
    periods: (hours.data ?? []).map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
    })),
  };
}

/** Replaces the whole weekly pattern; the resource now follows its own hours. */
export async function setResourceWorkingHours(
  db: Db,
  input: { resourceId: string; periods: WorkingPeriod[] },
): Promise<void> {
  await requireActor(db);
  const periods = validateWorkingPeriods(input.periods);

  const { error } = await db.rpc('set_resource_working_hours', {
    p_resource_id: input.resourceId,
    p_hours: periods.map((period) => ({
      day_of_week: period.dayOfWeek,
      opens_at: period.opensAt,
      closes_at: period.closesAt,
    })),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change this resource’s working hours.', 'resource_hours.forbidden');
    }
    if (error.code === '23P01') {
      throw new DomainError('Two working periods on the same day overlap.', 'resource_hours.overlap');
    }
    throw new DomainError(error.message, 'resource_hours.set_failed');
  }
}

/** Back to the organization's hours. The resource's own periods are removed with its schedule. */
export async function inheritOrganizationHours(db: Db, input: { resourceId: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('use_organization_hours', { p_resource_id: input.resourceId });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change this resource’s working hours.', 'resource_hours.forbidden');
    }
    throw new DomainError(error.message, 'resource_hours.clear_failed');
  }
}

export async function listResourceAvailabilityExceptions(
  db: Db,
  input: {
    organizationId: string;
    resourceId?: string;
    /** Only exceptions that end after this instant — what is still to come, or still running. */
    endingAfter?: string;
    /** Only exceptions that overlap this range. */
    within?: Window;
  },
): Promise<ResourceAvailabilityException[]> {
  let query = db
    .from('resource_availability_exceptions')
    .select('id, resource_id, starts_at, ends_at, kind, reason')
    .eq('organization_id', input.organizationId)
    .order('starts_at', { ascending: true });

  if (input.resourceId) query = query.eq('resource_id', input.resourceId);
  if (input.endingAfter) query = query.gt('ends_at', input.endingAfter);
  if (input.within) query = query.lt('starts_at', input.within.endsAt).gt('ends_at', input.within.startsAt);

  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'resource_exceptions.list_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    window: { startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString() },
    kind: 'unavailable' as const,
    reason: row.reason,
  }));
}

function checkException(input: { startsAt: string; endsAt: string; reason?: string | null }) {
  if (Number.isNaN(new Date(input.startsAt).getTime()) || Number.isNaN(new Date(input.endsAt).getTime())) {
    throw new DomainError('Give a start and an end.', 'resource_exceptions.window_invalid');
  }
  if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
    throw new DomainError('An exception must end after it starts.', 'resource_exceptions.ends_before_starts');
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length > 200) {
    throw new DomainError('Keep the reason under 200 characters.', 'resource_exceptions.reason_too_long');
  }
  return reason === '' ? null : reason;
}

function exceptionFailure(error: { code?: string; message: string }, code: string): DomainError {
  if (error.code === '42501') {
    return new DomainError('You cannot change this resource’s availability.', 'resource_exceptions.forbidden');
  }
  return new DomainError(error.message, code);
}

/**
 * Records time a resource cannot take part. It does not touch work already booked over it —
 * `listAvailabilityConflicts` reports that, because an operator may need to record the
 * absence first and repair the diary second.
 */
export async function createResourceAvailabilityException(
  db: Db,
  input: { resourceId: string; startsAt: string; endsAt: string; reason?: string | null },
): Promise<string> {
  await requireActor(db);
  const reason = checkException(input);

  const { data, error } = await db.rpc('create_resource_availability_exception', {
    p_resource_id: input.resourceId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_reason: reason ?? '',
  });
  if (error) throw exceptionFailure(error, 'resource_exceptions.create_failed');
  return data;
}

export async function updateResourceAvailabilityException(
  db: Db,
  input: { id: string; startsAt: string; endsAt: string; reason?: string | null },
): Promise<void> {
  await requireActor(db);
  const reason = checkException(input);

  const { error } = await db.rpc('update_resource_availability_exception', {
    p_id: input.id,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_reason: reason ?? '',
  });
  if (error) throw exceptionFailure(error, 'resource_exceptions.update_failed');
}

export async function deleteResourceAvailabilityException(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('delete_resource_availability_exception', { p_id: input.id });
  if (error) throw exceptionFailure(error, 'resource_exceptions.delete_failed');
}

/**
 * When each resource is open within a range: organization hours ∩ its own hours − its
 * exceptions, with commitments **not** subtracted — that is the difference between *open* (expected
 * to work) and *free* (open and uncommitted). A resource with nothing open appears with an empty
 * list, so a caller can tell "closed" from "unknown".
 *
 * The one reader that crosses to a public booking visitor, who is bound to one business.
 */
export async function listResourceOpenWindows(
  db: Db,
  input: { organizationId: string; within: Window; resourceIds: string[] },
): Promise<Map<string, Window[]>> {
  const { data, error } = await db.rpc('resource_open_windows', {
    p_organization_id: input.organizationId,
    p_from: input.within.startsAt,
    p_to: input.within.endsAt,
  });
  if (error) throw new DomainError(error.message, 'resource_open.read_failed');

  const open = new Map<string, Window[]>(input.resourceIds.map((id) => [id, []]));
  for (const row of data ?? []) {
    const window = parseWindow(row.during as string | null);
    if (!window || !open.has(row.resource_id)) continue;
    open.get(row.resource_id)!.push(window);
  }
  for (const windows of open.values()) windows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return open;
}

/**
 * Scheduled work that sits outside the hours or over an exception of a resource on it. This is
 * what changing hours or adding time off over booked work looks like afterwards: nothing was
 * refused and nothing moved, so it is reported here instead.
 */
export async function listAvailabilityConflicts(
  db: Db,
  input: { organizationId: string; within: Window },
): Promise<AvailabilityConflict[]> {
  const { data, error } = await db.rpc('resource_availability_conflicts', {
    p_organization_id: input.organizationId,
    p_from: input.within.startsAt,
    p_to: input.within.endsAt,
  });
  if (error) throw new DomainError(error.message, 'resource_conflicts.read_failed');

  return (data ?? []).map((row) => ({
    workItemId: row.work_item_id,
    resourceId: row.resource_id,
    problem: row.problem === 'unavailable' ? 'unavailable' : 'outside_hours',
  }));
}

/**
 * A person's local entry as the instants it means in the organization's zone — never the
 * server's or the browser's. `startDate`/`endDate` are tenant calendar dates (`YYYY-MM-DD`); with
 * no times it is the whole of those days, which is not 24 hours across a DST change.
 */
export function exceptionInstants(input: {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  timeZone: string;
}): Window {
  const allDay = !input.startTime && !input.endTime;
  if (allDay) {
    return {
      startsAt: zonedDayRange(input.startDate, input.timeZone).startsAt,
      endsAt: zonedDayRange(input.endDate, input.timeZone).endsAt,
    };
  }
  return {
    startsAt: zonedTimeToInstant(input.startDate, input.startTime ?? '00:00', input.timeZone),
    endsAt: zonedTimeToInstant(input.endDate, input.endTime ?? '00:00', input.timeZone),
  };
}
