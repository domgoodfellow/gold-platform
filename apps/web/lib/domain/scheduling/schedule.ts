import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Committing work to a resource and a window.
 *
 * **The overlap check is not here, and must never be.** I7 says two work items can never
 * occupy the same resource and window, and `roadmap.md` is explicit that "an
 * application-level overlap check is not this milestone". The guarantee is
 * `work_items_resource_not_double_booked`, a gist exclusion constraint, and what this file
 * does with it is turn `23P01` into a sentence.
 *
 * That is also what makes I6 true rather than aspirational. Availability shown to anyone is
 * advisory — it was computed before this call and the world moved on — and the re-assertion
 * is the constraint refusing the insert at commit time. No amount of checking first can
 * close that window; only a constraint held by the same transaction can.
 */
export async function scheduleWorkItem(
  db: Db,
  input: {
    workItemId: string;
    /** Null schedules a time with nobody assigned yet, which cannot double-book anyone. */
    resourceId?: string | null;
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
    // Null by design, not by omission: see the parameter above. The cast is D15's — Postgres
    // records no nullability for a function argument.
    p_resource_id: (input.resourceId || null) as string,
    p_starts_at: starts.toISOString(),
    p_ends_at: ends.toISOString(),
  });

  if (error) {
    // 23P01 is the exclusion constraint. This is I7 firing, and it is the only thing that
    // could have caught a race between two dispatchers looking at the same free slot.
    if (error.code === '23P01') {
      throw new DomainError(
        'That resource is already booked for part of this window.',
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
    if (error.code === '23503') {
      throw new DomainError('No such resource here.', 'scheduling.resource_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot schedule that work item.', 'scheduling.forbidden');
    }
    throw new DomainError(error.message, 'scheduling.failed');
  }
}

/** Take a work item off the schedule, freeing whatever it was holding. */
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
    throw new DomainError(error.message, 'scheduling.failed');
  }
}
