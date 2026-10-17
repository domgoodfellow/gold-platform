import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * How a call can go, in this business's own words.
 *
 * **This is the table that keeps a dialer general.** Every system that has solved this before
 * ships a fixed list — no answer, voicemail, wrong number, interested, qualified, appointment
 * booked — in a check constraint. That list is one company's sales process, and the next
 * company's differs in ways that matter to it and to nobody else. The tenant-vocabulary rule is the rule; this is what
 * the rule looks like when a second vertical arrives.
 *
 * **One platform fact rides along, and only one.** `reached` answers *did somebody actually
 * speak to somebody*, because a business's own words cannot: *gatekeeper* and *left voicemail*
 * are both failures to connect and neither says so in its name. Anything counting connect rate
 * has to ask, so it asks the business once, when the outcome is named — rather than guessing
 * from a word it does not own.
 */

export type CallOutcome = {
  id: string;
  name: string;
  position: number;
  /** Whether this outcome counts as having spoken to somebody. The tenant's answer. */
  reached: boolean;
};

const NAME_MAX = 64;

export async function listCallOutcomes(
  db: Db,
  input: { organizationId: string },
): Promise<CallOutcome[]> {
  const { data, error } = await db
    .from('call_outcomes')
    .select('id, name, position, reached')
    .eq('organization_id', input.organizationId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'call_outcomes.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    reached: row.reached,
  }));
}

export async function createCallOutcome(
  db: Db,
  input: { organizationId: string; name: string; reached: boolean; position?: number },
): Promise<string> {
  const actor = await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('An outcome needs a name.', 'call_outcomes.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'call_outcomes.name_too_long',
    );
  }

  const { data, error } = await db
    .from('call_outcomes')
    .insert({
      organization_id: input.organizationId,
      name,
      reached: input.reached,
      position: input.position ?? 0,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'This business already has an outcome with that name.',
        'call_outcomes.name_taken',
      );
    }
    throw new DomainError(error.message, 'call_outcomes.create_failed');
  }

  return data.id;
}
