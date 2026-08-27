import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * A state a work item can be in, in the tenant's own vocabulary.
 *
 * D6: statuses are data, not enums. Nothing in this file knows what any status *means* —
 * "Booked", "Awaiting parts" and "Op de planning" are all just rows — and that is the point.
 * Which transitions between them are legal is I13, and belongs to M2.
 */
export type WorkItemStatus = {
  id: string;
  name: string;
  position: number;
};

const NAME_MAX = 64;

export async function listWorkItemStatuses(
  db: Db,
  input: { organizationId: string },
): Promise<WorkItemStatus[]> {
  const { data, error } = await db
    .from('work_item_statuses')
    .select('id, name, position')
    .eq('organization_id', input.organizationId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'statuses.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
  }));
}

/**
 * Add a status to this tenant's board.
 *
 * `position` defaults to the end rather than to zero, because a status added to a board is
 * almost always a later stage, and a table of statuses that all claim position 0 is a board
 * in arbitrary order. The caller may still say where it goes.
 */
export async function createWorkItemStatus(
  db: Db,
  input: { organizationId: string; name: string; position?: number },
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

  let position = input.position;
  if (position === undefined) {
    const existing = await listWorkItemStatuses(db, {
      organizationId: input.organizationId,
    });
    position = existing.reduce((highest, status) => Math.max(highest, status.position), -1) + 1;
  }

  if (!Number.isInteger(position) || position < 0) {
    throw new DomainError('A position is a whole number, zero or more.', 'statuses.position_invalid');
  }

  const { data, error } = await db.rpc('create_work_item_status', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_position: position,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(`A status called ${name} already exists here.`, 'statuses.name_taken');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure statuses here.', 'statuses.forbidden');
    }
    throw new DomainError(error.message, 'statuses.create_failed');
  }

  return data;
}
