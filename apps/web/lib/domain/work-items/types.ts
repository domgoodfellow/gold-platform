import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What kind of work this is, in the tenant's own vocabulary.
 *
 * Nothing in this file — or anywhere else — branches on which type a work item has. A type
 * scopes which statuses apply and which moves between them are legal, and that is the whole
 * of it. `domain-model.md` claims a job, service call, inspection, delivery, installation,
 * booking and appointment are one table with different configuration; a `switch` on a type
 * name is that claim being quietly abandoned.
 */
export type WorkItemType = {
  id: string;
  name: string;
  /**
   * Whether work of this kind occupies a scheduled time — the business's own declaration of the
   * shape of its work. Not whether it is publicly bookable (bookable implies it; never the
   * reverse), not whether any is scheduled now, and never inferred from resources or bookings.
   */
  schedulable: boolean;
};

const NAME_MAX = 64;

/**
 * The types this organization has defined, by name.
 *
 * Ordered by name rather than by a stored position, because a list of types is a picker and
 * has no left-to-right meaning — unlike a board, where the order of the columns *is* the
 * process.
 */
export async function listWorkItemTypes(
  db: Db,
  input: { organizationId: string },
): Promise<WorkItemType[]> {
  const { data, error } = await db
    .from('work_item_types')
    .select('id, name, schedulable')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'work_item_types.list_failed');
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, schedulable: row.schedulable }));
}

/**
 * **The business states whether this work is scheduled, every time — there is no default.** The
 * platform does not answer *does this business schedule* from its name, its resources or what it
 * has booked, so the argument is required here and the column has no default in the database.
 */
export async function createWorkItemType(
  db: Db,
  input: { organizationId: string; name: string; schedulable: boolean },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A type needs a name.', 'work_item_types.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'work_item_types.name_too_long',
    );
  }

  const { data, error } = await db.rpc('create_work_item_type', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_schedulable: input.schedulable,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `A type called ${name} already exists here.`,
        'work_item_types.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot configure work item types here.',
        'work_item_types.forbidden',
      );
    }
    throw new DomainError(error.message, 'work_item_types.create_failed');
  }

  return data;
}

/**
 * Rename a type.
 *
 * Nothing moves. Every status, transition and work item references the type by id, so a
 * business that decides "Callout" was always really "Service visit" changes one row and no
 * job notices — which is what D6 buys by making the tenant's word data rather than an enum.
 */
export async function renameWorkItemType(
  db: Db,
  input: { id: string; name: string },
): Promise<void> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A type needs a name.', 'work_item_types.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'work_item_types.name_too_long',
    );
  }

  const { error } = await db.rpc('rename_work_item_type', { p_id: input.id, p_name: name });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `A type called ${name} already exists here.`,
        'work_item_types.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot configure work item types here.',
        'work_item_types.forbidden',
      );
    }
    throw new DomainError(error.message, 'work_item_types.update_failed');
  }
}

/**
 * Whether this organization has declared any kind of work that is scheduled — **the one answer**
 * Schedule, Resources, Locations, Field Home and setup all ask. It is read from the declaration
 * itself, never from how many jobs, resources, locations or bookings exist: a business that
 * schedules and has not yet booked anything still schedules.
 */
export async function hasSchedulableWork(
  db: Db,
  input: { organizationId: string },
): Promise<boolean> {
  const { data, error } = await db
    .from('work_item_types')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('schedulable', true)
    .limit(1);

  if (error) {
    throw new DomainError(error.message, 'work_item_types.schedulable_read_failed');
  }

  return (data ?? []).length > 0;
}

/**
 * Declare whether work of this type is scheduled.
 *
 * Turning it off is refused by the database while any item of the type holds a scheduled window
 * (`app.check_type_has_no_scheduled_work`), and while the type is publicly bookable
 * (`work_item_types_bookable_is_schedulable`) — this only turns each into a sentence. Nothing is
 * unscheduled or unpublished on the caller's behalf.
 */
export async function setWorkItemTypeSchedulable(
  db: Db,
  input: { id: string; schedulable: boolean },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('set_work_item_type_schedulable', {
    p_id: input.id,
    p_schedulable: input.schedulable,
  });

  if (error) {
    if (error.code === 'GD006') {
      throw new DomainError(
        'This work type still has scheduled work. Unschedule those items before turning scheduling off.',
        'work_item_types.has_scheduled_work',
      );
    }
    if (error.code === 'GD009') {
      throw new DomainError(
        'This work type still needs resources. Remove the resource requirements before turning scheduling off.',
        'work_item_types.has_requirements',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(
        'This work type is open for public booking, which needs it to be scheduled. Withdraw its booking first.',
        'work_item_types.is_bookable',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot configure work item types here.',
        'work_item_types.forbidden',
      );
    }
    throw new DomainError(error.message, 'work_item_types.scheduling_failed');
  }
}

/**
 * What one type publishes, or null when it publishes nothing.
 *
 * **A second reader rather than columns added to `listWorkItemTypes`, and deliberately.** That
 * function answers *what kinds of work does this business have* — it is the board's picker and
 * the job form's dropdown, and it is called on screens that have nothing to do with the public
 * page. Widening it would put three booking columns into every one of those, and
 * `outstandingModuleSetup` already reads the table directly rather than use it, for exactly
 * this reason.
 *
 * It reads one type because the screen configures one at a time.
 */
export type TypeBooking = {
  statusId: string;
  durationMinutes: number;
  priceItemId: string | null;
};

export async function getTypeBooking(
  db: Db,
  input: { organizationId: string; typeId: string },
): Promise<TypeBooking | null> {
  const { data, error } = await db
    .from('work_item_types')
    .select('booking_status_id, booking_duration_minutes, booking_price_item_id')
    .eq('organization_id', input.organizationId)
    .eq('id', input.typeId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'work_item_types.booking_read_failed');
  }

  // A status and a duration are the whole of what "published" means, and
  // `work_item_types_bookable_is_complete` keeps the pair together — so one null is enough to
  // answer, and there is no third state to represent.
  if (!data?.booking_status_id || data.booking_duration_minutes === null) return null;

  return {
    statusId: data.booking_status_id,
    durationMinutes: data.booking_duration_minutes,
    priceItemId: data.booking_price_item_id,
  };
}

/**
 * Publish a type for public booking, or withdraw it.
 *
 * **There is no `bookable` flag**, and that is the design rather than an omission. A type is
 * bookable when the business has said which of that type's own statuses a booking arrives in
 * and how long one takes; passing `null` for the status withdraws it. A boolean beside those
 * columns would be a second answer able to contradict the first — bookable with no status, or
 * a status and not bookable — and a check constraint makes the pair the whole answer instead.
 *
 * The status must belong to *this type*, and the database says so: the reference is
 * `(organization_id, id, booking_status_id)` against `work_item_statuses (organization_id,
 * type_id, id)`, which is I20's three-column shape. A booking cannot arrive in another type's
 * column even by writing the row directly.
 *
 * The price is optional. A business may take bookings without publishing what it charges, and
 * saying nothing is different from saying zero.
 */
export async function setTypeBookable(
  db: Db,
  input: {
    id: string;
    statusId: string | null;
    durationMinutes: number | null;
    priceItemId?: string | null;
  },
): Promise<void> {
  await requireActor(db);

  const publishing = input.statusId !== null;

  if (publishing && (!Number.isInteger(input.durationMinutes) || input.durationMinutes === null)) {
    throw new DomainError(
      'A bookable type needs to say how long the work takes.',
      'types.booking_duration_required',
    );
  }
  if (publishing && (input.durationMinutes! < 5 || input.durationMinutes! > 1440)) {
    throw new DomainError(
      'A booking lasts between five minutes and a day.',
      'types.booking_duration_invalid',
    );
  }

  const { error } = await db.rpc('set_type_bookable', {
    p_id: input.id,
    p_status_id: (input.statusId ?? null) as string,
    p_duration_minutes: (publishing ? input.durationMinutes : null) as number,
    p_price_item_id: (input.priceItemId || null) as string,
  });

  if (error) {
    // The three-column reference refusing a status that belongs to another type (I20), or a
    // price book item that is not this tenant's.
    if (error.code === '23503') {
      throw new DomainError(
        'That status belongs to a different kind of work, or that price is not this business’s.',
        'types.booking_reference_invalid',
      );
    }
    // `app.check_bookable_type_requirements`: public booking commits one resource.
    if (error.code === 'GD011') {
      throw new DomainError(
        'Public booking currently supports one required resource. Remove the additional resource requirements or turn public booking off.',
        'types.booking_requirements_incompatible',
      );
    }
    if (error.code === '23514') {
      // Two checks share this code; the constraint's name, which Postgres puts in the message, says which.
      if (error.message.includes('work_item_types_bookable_is_schedulable')) {
        throw new DomainError(
          'This work is not scheduled, so it cannot be booked. Turn scheduling on for it first.',
          'types.booking_requires_schedulable',
        );
      }
      throw new DomainError(
        'A bookable type needs both a status and a duration.',
        'types.booking_incomplete',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure work item types here.', 'types.forbidden');
    }
    throw new DomainError(error.message, 'types.booking_failed');
  }
}
