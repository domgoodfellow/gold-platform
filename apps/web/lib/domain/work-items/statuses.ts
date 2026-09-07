import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * A state a work item of one type can be in, in the tenant's own vocabulary (D6) — statuses are
 * data, not enums. A status belongs to a **type**, not the organization: two types can both
 * have a "Scheduled" column, hence the unique index on `(organization_id, type_id, lower(name))`.
 */
export type WorkItemStatus = {
  id: string;
  name: string;
  position: number;
  /**
   * Whether work in this status still occupies its resource — deliberately not `isTerminal`.
   * "Cancelled" and "No show" release the resource; "Awaiting parts" doesn't, because the work
   * is still there.
   */
  releasesResource: boolean;
  /**
   * Whether moving into this status means the work was done — separate from `releasesResource`
   * on purpose (M4): "Cancelled" releases the resource without completing work. Read afterwards
   * by `work_marked_complete` against the event log, so changing the answer re-reads history
   * rather than rewriting it.
   */
  marksComplete: boolean;
};

const NAME_MAX = 64;

/** `typeId` required — an organization-wide list would be every type's columns interleaved, which no screen wants. */
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

/** `position` defaults to the end, not zero — a status added later is almost always a later stage. */
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
 * Rename a status, or move it along the board. `releasesResource` reaches work already
 * committed on purpose — marking "Cancelled" as releasing frees every job already sitting in
 * it. Type is not changeable: I20's constraint would refuse a status moved to another type
 * while work items still reference it.
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
    // Reachable only when releasesResource flips true → false — the tenant just asserted that
    // two overlapping jobs both hold the same resource.
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
