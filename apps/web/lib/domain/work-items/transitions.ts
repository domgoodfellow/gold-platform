import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Which moves between statuses a tenant allows, per work item type. This is the status-transition rule.
 *
 * Nothing here decides what a move *means*. A transition is a pair of status ids the tenant
 * wired together, and the platform's only opinion is that a move nobody configured is not a
 * move — see the migration for why an unconfigured type is frozen rather than unconstrained.
 *
 * The guarantee is `app.check_status_transition`, a trigger, so a direct PostgREST update is
 * refused exactly as a form is. What this file adds is the *sentence*: the trigger can
 * only name uuids, and a person needs to be told which column they tried to move to. That is
 * the same division of labour `parseCustom` has with the custom-fields trigger for the custom-field registry rule.
 */
export type WorkItemTransition = {
  id: string;
  fromStatusId: string;
  toStatusId: string;
};

/**
 * Every configured move for one type.
 *
 * The board needs the whole set rather than one status's worth, because it renders a row of
 * buttons per work item and there is no sense in a round trip per card.
 */
export async function listWorkItemTransitions(
  db: Db,
  input: { organizationId: string; typeId: string },
): Promise<WorkItemTransition[]> {
  const { data, error } = await db
    .from('work_item_transitions')
    .select('id, from_status_id, to_status_id')
    .eq('organization_id', input.organizationId)
    .eq('type_id', input.typeId);

  if (error) {
    throw new DomainError(error.message, 'transitions.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
  }));
}

/** The statuses a work item currently in `fromStatusId` may be moved to. */
export function allowedNextStatusIds(
  transitions: WorkItemTransition[],
  fromStatusId: string,
): string[] {
  return transitions
    .filter((transition) => transition.fromStatusId === fromStatusId)
    .map((transition) => transition.toStatusId);
}

export async function createWorkItemTransition(
  db: Db,
  input: {
    organizationId: string;
    typeId: string;
    fromStatusId: string;
    toStatusId: string;
  },
): Promise<string> {
  await requireActor(db);

  if (!input.fromStatusId || !input.toStatusId) {
    throw new DomainError(
      'A transition needs a status to move from and a status to move to.',
      'transitions.statuses_required',
    );
  }

  if (input.fromStatusId === input.toStatusId) {
    throw new DomainError(
      'A status cannot move to itself.',
      'transitions.self_transition',
    );
  }

  const { data, error } = await db.rpc('create_work_item_transition', {
    p_organization_id: input.organizationId,
    p_type_id: input.typeId,
    p_from_status_id: input.fromStatusId,
    p_to_status_id: input.toStatusId,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('That move is already allowed.', 'transitions.already_allowed');
    }
    // A three-column reference refusing a status that is not in this organization, or is in
    // it but belongs to another type. From the caller's position both are the same
    // fact: not a status on this board.
    if (error.code === '23503') {
      throw new DomainError(
        'No such status on this work item type.',
        'transitions.status_not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure transitions here.', 'transitions.forbidden');
    }
    throw new DomainError(error.message, 'transitions.create_failed');
  }

  return data;
}

/**
 * Move a work item along its board.
 *
 * The legality of the move is not decided here — `app.check_status_transition` decides it,
 * and would refuse this call whatever this function believed. What happens here is that the
 * refusal is turned into a sentence naming the two columns, which the trigger cannot do
 * because it holds ids and not the tenant's words.
 */
export async function changeWorkItemStatus(
  db: Db,
  input: { workItemId: string; toStatusId: string },
): Promise<void> {
  await requireActor(db);

  if (!input.toStatusId) {
    throw new DomainError('A work item needs a status.', 'work_items.status_required');
  }

  const { error } = await db.rpc('change_work_item_status', {
    p_work_item_id: input.workItemId,
    p_status_id: input.toStatusId,
  });

  if (error) {
    if (error.code === '23514') {
      throw new DomainError(
        'That move is not allowed from where this work item is now.',
        'work_items.transition_not_allowed',
      );
    }
    // One code for "no such work item" and for "not yours to move", because the database
    // deliberately does not distinguish them: telling them apart would tell the caller that
    // a work item they cannot touch exists. Same reasoning as `assign_role`.
    if (error.code === '42501') {
      throw new DomainError('You cannot move that work item.', 'work_items.transition_forbidden');
    }
    throw new DomainError(error.message, 'work_items.transition_failed');
  }
}
