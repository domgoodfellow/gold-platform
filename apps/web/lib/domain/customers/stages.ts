import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Where a relationship has got to, in this business's own words.
 *
 * **The platform ships none and seeds none.** A business that has named no stages has customers
 * with no stage, which is the honest reading of *it has said nothing* — the same answer
 * operating hours give, and for the same reason: a seeded *Prospect / Qualified / Customer* is
 * one industry's pipeline wearing a default's clothing.
 */

export type CustomerStage = {
  id: string;
  name: string;
  position: number;
};

const NAME_MAX = 64;

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('A stage needs a name.', 'customer_stages.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'customer_stages.name_too_long',
    );
  }
  return name;
}

/** This business's pipeline, in the order it put them in. */
export async function listCustomerStages(
  db: Db,
  input: { organizationId: string },
): Promise<CustomerStage[]> {
  const { data, error } = await db
    .from('contact_relationship_stages')
    .select('id, name, position')
    .eq('organization_id', input.organizationId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw fromDatabaseError(error, 'customer_stages.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
  }));
}

export async function createCustomerStage(
  db: Db,
  input: { organizationId: string; name: string; position?: number },
): Promise<string> {
  const actor = await requireActor(db);
  const name = cleanName(input.name);

  const { data, error } = await db
    .from('contact_relationship_stages')
    .insert({
      organization_id: input.organizationId,
      name,
      position: input.position ?? 0,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 is the tenant-scoped unique index doing its job. The message names the rule,
    // because "duplicate key" is true and useless.
    if (error.code === '23505') {
      throw new DomainError(
        'This business already has a stage with that name.',
        'customer_stages.name_taken',
      );
    }
    throw fromDatabaseError(error, 'customer_stages.create_failed');
  }

  return data.id;
}

/**
 * Rename a stage, or move it along the board.
 *
 * **A rename is safe here in a way it is not on a field definition.** A stage carries no stored
 * values and reinterprets nothing: customers point at it by id, so changing the word changes
 * what everybody reads and orphans nothing. `field_definitions.kind` refuses an edit for the
 * opposite reason — it would reinterpret every value already stored under that key.
 */
export async function updateCustomerStage(
  db: Db,
  input: { id: string; name: string; position: number },
): Promise<void> {
  await requireActor(db);
  const name = cleanName(input.name);

  if (!Number.isInteger(input.position) || input.position < 0) {
    throw new DomainError('A position is a whole number.', 'customer_stages.position_invalid');
  }

  const { data, error } = await db
    .from('contact_relationship_stages')
    .update({ name, position: input.position })
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'This business already has a stage with that name.',
        'customer_stages.name_taken',
      );
    }
    throw fromDatabaseError(error, 'customer_stages.update_failed');
  }

  // No row means the policy refused it or it belongs to another business, and those are
  // indistinguishable on purpose — the same reason `getCustomer` returns null for both.
  if ((data ?? []).length === 0) {
    throw new DomainError(
      'That stage is not yours to change.',
      'customer_stages.update_refused',
    );
  }
}

/**
 * Remove a relationship stage that nothing uses. The database refuses while any contact or
 * marketing audience is still on it (`delete_relationship_stage`), so a removal never silently
 * clears a contact's stage.
 */
export async function deleteCustomerStage(db: Db, input: { organizationId: string; id: string }): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('delete_relationship_stage', { p_organization_id: input.organizationId, p_stage_id: input.id });
  if (!error) return;
  if (error.code === '23503') throw fromDatabaseError(error, 'customer_stages.in_use');
  if (error.code === '42501') throw new DomainError('That stage is not yours to remove.', 'customer_stages.delete_refused');
  throw fromDatabaseError(error, 'customer_stages.delete_failed');
}

/** How many contacts are on each stage, keyed by stage id. */
export async function customerStageUsage(db: Db, organizationId: string): Promise<Map<string, number>> {
  const { data, error } = await db.rpc('relationship_stage_usage', { p_organization_id: organizationId });
  if (error) throw fromDatabaseError(error, 'customer_stages.usage_failed');
  return new Map((data ?? []).map(row => [row.stage_id, row.contacts]));
}

/**
 * Move one stage up or down by renumbering the list 0…n-1 in its new order, through the same
 * position column and update every other stage edit uses. Only rows whose position changes are
 * written. Equal legacy positions are settled into the order the list already shows.
 */
export async function moveCustomerStage(db: Db, input: { organizationId: string; id: string; direction: 'up' | 'down' }): Promise<void> {
  const stages = await listCustomerStages(db, { organizationId: input.organizationId });
  const index = stages.findIndex(stage => stage.id === input.id);
  if (index < 0) throw new DomainError('That stage is not yours to change.', 'customer_stages.update_refused');
  const target = input.direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= stages.length) return;
  const order = [...stages];
  [order[index], order[target]] = [order[target], order[index]];
  for (const [position, stage] of order.entries()) {
    if (stage.position !== position) await updateCustomerStage(db, { id: stage.id, name: stage.name, position });
  }
}
