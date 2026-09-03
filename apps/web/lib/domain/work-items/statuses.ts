import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * A state a work item of one type can be in, in the tenant's own vocabulary.
 *
 * D6: statuses are data, not enums. Nothing in this file knows what any status *means* —
 * "Booked", "Awaiting parts" and "Op de planning" are all just rows — and that is the point.
 * Which transitions between them are legal is I13, and belongs to the next slice.
 *
 * A status belongs to a **type**, not to the organization. Two types both having a
 * "Scheduled" column is the ordinary shape of a business that installs and also repairs,
 * and the database now says so: the unique index is
 * `(organization_id, type_id, lower(name))`.
 */
export type WorkItemStatus = {
  id: string;
  name: string;
  position: number;
  /**
   * Whether work in this status still occupies its resource.
   *
   * The one question the platform asks about a status, and it is deliberately not
   * `isTerminal`. That flag would be the platform deciding what a status *means*; this asks
   * the tenant something only they can answer about their own word. "Cancelled" and "No show"
   * release the van; "Awaiting parts" does not, because the vehicle is still on the lift.
   *
   * It reaches the exclusion constraint through a mirrored column on `work_items` — see the
   * migration for why a constraint predicate cannot read it from here.
   */
  releasesResource: boolean;
  /**
   * Whether moving work into this status means the work was done.
   *
   * **The second question the platform asks about a status, and it is separate from the first
   * on purpose.** "Cancelled" releases the van and is not completed work; "Awaiting parts"
   * holds the van and is not completed work either. One flag could not have said both, which
   * is exactly why M4 refused a single `isTerminal` and answered the question it actually had.
   *
   * Nothing reads it at the moment work moves. It is read afterwards, against the event log,
   * by `work_marked_complete` — so changing the answer re-reads history rather than rewriting
   * it, and a business that decides "Delivered" was always the finish line sees last year
   * counted correctly the moment it says so.
   */
  marksComplete: boolean;
};

const NAME_MAX = 64;

/**
 * One type's board, in board order.
 *
 * `typeId` is required rather than optional. An organization-wide status list would be every
 * type's columns interleaved, which is not a board and is not a picker either — there is no
 * screen that wants it, so there is no signature for it.
 */
export async function listWorkItemStatuses(
  db: Db,
  input: { organizationId: string; typeId: string },
): Promise<WorkItemStatus[]> {
  const { data, error } = await db
    .from('work_item_statuses')
    .select('id, name, position, releases_resource, marks_complete')
    .eq('organization_id', input.organizationId)
    .eq('type_id', input.typeId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'statuses.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    releasesResource: row.releases_resource,
    marksComplete: row.marks_complete,
  }));
}

/**
 * Add a status to one type's board.
 *
 * `position` defaults to the end rather than to zero, because a status added to a board is
 * almost always a later stage, and a table of statuses that all claim position 0 is a board
 * in arbitrary order. The caller may still say where it goes.
 */
export async function createWorkItemStatus(
  db: Db,
  input: { organizationId: string; typeId: string; name: string; position?: number },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A status needs a name.', 'statuses.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'statuses.name_too_long',
    );
  }

  if (!input.typeId) {
    throw new DomainError('A status belongs to a work item type.', 'statuses.type_required');
  }

  let position = input.position;
  if (position === undefined) {
    const existing = await listWorkItemStatuses(db, {
      organizationId: input.organizationId,
      typeId: input.typeId,
    });
    position = existing.reduce((highest, status) => Math.max(highest, status.position), -1) + 1;
  }

  if (!Number.isInteger(position) || position < 0) {
    throw new DomainError(
      'A position is a whole number, zero or more.',
      'statuses.position_invalid',
    );
  }

  const { data, error } = await db.rpc('create_work_item_status', {
    p_organization_id: input.organizationId,
    p_type_id: input.typeId,
    p_name: name,
    p_position: position,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(`A status called ${name} already exists here.`, 'statuses.name_taken');
    }
    // The composite reference to work_item_types refusing a type that is not in this
    // organization. From the caller's position that type does not exist.
    if (error.code === '23503') {
      throw new DomainError('No such work item type here.', 'statuses.type_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure statuses here.', 'statuses.forbidden');
    }
    throw new DomainError(error.message, 'statuses.create_failed');
  }

  return data;
}

/**
 * Rename a status, or move it along the board.
 *
 * Renaming moves no work: a work item references its status by id, so every job sitting in
 * "Booked" is sitting in the same row once it becomes "Scheduled". The type is deliberately
 * not changeable — moving a status to another type would strand every work item in it and
 * every transition wired to it, and I20's constraint would refuse it anyway.
 *
 * `releasesResource` is the one field here that reaches work already committed, and it is
 * meant to. Marking "Cancelled" as releasing frees the van on every job already sitting in
 * it, which is the only reading that helps — a tenant who says a status does not hold a
 * resource is not making a claim about the future.
 */
export async function updateWorkItemStatus(
  db: Db,
  input: {
    id: string;
    name: string;
    position: number;
    releasesResource: boolean;
    marksComplete: boolean;
  },
): Promise<void> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A status needs a name.', 'statuses.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'statuses.name_too_long',
    );
  }
  if (!Number.isInteger(input.position) || input.position < 0) {
    throw new DomainError(
      'A position is a whole number, zero or more.',
      'statuses.position_invalid',
    );
  }

  const { error } = await db.rpc('update_work_item_status', {
    p_id: input.id,
    p_name: name,
    p_position: input.position,
    p_releases_resource: input.releasesResource,
    p_marks_complete: input.marksComplete,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(`A status called ${name} already exists here.`, 'statuses.name_taken');
    }
    // Reachable only when releasesResource goes true → false: the tenant has just asserted
    // that two overlapping jobs both hold the same resource, and the exclusion constraint
    // refuses inside the propagation trigger rather than letting the board become something
    // the schedule cannot draw.
    if (error.code === '23P01') {
      throw new DomainError(
        'Work already in this status overlaps on the same resource, so it cannot start holding one again. Reschedule that work first.',
        'statuses.release_conflict',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure statuses here.', 'statuses.forbidden');
    }
    throw new DomainError(error.message, 'statuses.update_failed');
  }
}
