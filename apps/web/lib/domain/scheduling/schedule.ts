import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Committing work to a resource and a window.
 *
 * **The overlap check is not here, and must never be.** The no-double-booking constraint says two work items can never
 * occupy the same resource and window, and `roadmap.md` is explicit that "an
 * application-level overlap check is not this milestone". The guarantee is
 * `work_items_resource_not_double_booked`, a gist exclusion constraint, and what this file
 * does with it is turn `23P01` into a sentence.
 *
 * That is also what makes the advisory-availability rule true rather than aspirational. Availability shown to anyone is
 * advisory — it was computed before this call and the world moved on — and the re-assertion
 * is the constraint refusing the insert at commit time. No amount of checking first can
 * close that window; only a constraint held by the same transaction can.
 */
export async function scheduleWorkItem(
  db: Db,
  input: {
    workItemId: string;
    /**
     * Who is on the job. **Omitted leaves the assignments exactly as they are** — rescheduling is
     * about time and must not quietly take people off the job. An empty list clears them, and a
     * list replaces them; work with a time and nobody on it is ordinary and cannot double-book
     * anyone. Every resource named is tested against the whole window in the same transaction,
     * so one that is busy refuses the move and nothing changes.
     */
    resourceIds?: string[];
    startsAt: string;
    endsAt: string;
  },
): Promise<void> {
  await requireActor(db);

  if (!input.startsAt || !input.endsAt) {
    throw new DomainError(
      'A scheduled window needs a start and an end.',
      'scheduling.window_required',
    );
  }

  const starts = new Date(input.startsAt);
  const ends = new Date(input.endsAt);

  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    throw new DomainError('That is not a time.', 'scheduling.window_invalid');
  }
  if (ends <= starts) {
    throw new DomainError(
      'A scheduled window must end after it starts.',
      'scheduling.window_backwards',
    );
  }

  const { error } = await db.rpc('schedule_work_item', {
    p_work_item_id: input.workItemId,
    // Null by design, not by omission: see the parameter above. The cast is the forward-only migration rule's — Postgres
    // records no nullability for a function argument.
    p_resource_ids: (input.resourceIds ?? null) as string[],
    p_starts_at: starts.toISOString(),
    p_ends_at: ends.toISOString(),
  });

  if (error) {
    // 23P01 is the exclusion constraint. This is the no-double-booking constraint firing, and it is the only thing that
    // could have caught a race between two dispatchers looking at the same free slot.
    if (error.code === '23P01') {
      throw new DomainError(
        'A resource on this job is already booked for part of that time.',
        'scheduling.double_booked',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(
        'A scheduled window must end after it starts.',
        'scheduling.window_backwards',
      );
    }
    // `app.check_work_item_type_is_schedulable`: the type was declared as work that does not use the schedule.
    if (error.code === 'GD005') {
      throw new DomainError(
        'This kind of work does not use the schedule.',
        'scheduling.type_not_schedulable',
      );
    }
    // The composite reference refusing a resource that is not in this tenant.
    // The assignment trigger's own sentence names the resource and what is wrong ("Alex is not
    // working at that time"), so it is passed through rather than replaced by a generic one.
    if (error.code === 'GD013') {
      throw fromDatabaseError(error, 'scheduling.resource_not_working');
    }
    if (error.code === '23503') {
      throw new DomainError('No such resource here.', 'scheduling.resource_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot schedule that work item.', 'scheduling.forbidden');
    }
    throw fromDatabaseError(error, 'scheduling.failed');
  }
}

/**
 * Change who is on a work item, without touching when it happens. One transaction for the whole
 * set: if any resource is busy for the work item's window, the assignments stay exactly as they
 * were. On work with no time yet nothing can conflict, so this simply records who is on it.
 *
 * Whether the caller may is the database's (`work_item.schedule`), however it arrives.
 */
export async function setWorkItemResources(
  db: Db,
  input: { workItemId: string; resourceIds: string[] },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('set_work_item_resources', {
    p_work_item_id: input.workItemId,
    p_resource_ids: input.resourceIds,
  });

  if (error) {
    if (error.code === '23P01') {
      throw new DomainError(
        'A resource on this job is already booked for part of that time.',
        'scheduling.double_booked',
      );
    }
    // The assignment trigger's own sentence names the resource and what is wrong ("Alex is not
    // working at that time"), so it is passed through rather than replaced by a generic one.
    if (error.code === 'GD013') {
      throw fromDatabaseError(error, 'scheduling.resource_not_working');
    }
    if (error.code === '23503') {
      throw new DomainError('No such resource here.', 'scheduling.resource_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot change who is on that work item.', 'scheduling.forbidden');
    }
    throw fromDatabaseError(error, 'scheduling.failed');
  }
}

/** Take a work item off the schedule, freeing every resource's time. Who is on the job stays. */
export async function unscheduleWorkItem(
  db: Db,
  input: { workItemId: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('unschedule_work_item', {
    p_work_item_id: input.workItemId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot schedule that work item.', 'scheduling.forbidden');
    }
    throw fromDatabaseError(error, 'scheduling.failed');
  }
}
