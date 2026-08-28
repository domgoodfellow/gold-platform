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
    .select('id, name')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'work_item_types.list_failed');
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

export async function createWorkItemType(
  db: Db,
  input: { organizationId: string; name: string },
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
