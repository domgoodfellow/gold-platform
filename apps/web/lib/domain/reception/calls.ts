import {
  callbackBase,
  telephonyProvider,
  telephonyProviderKey,
  type CallStatus,
} from '@/lib/adapters/telephony';
import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { getProviderBinding } from '@/lib/domain/providers/bindings';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The scope a business's own calls happen inside, or `null` for one with no telephony binding
 * yet — which is every business until staff provisions one, and `telephonyProvider` reads that
 * exactly like GOLD's master scope, unchanged (D39).
 */
async function actingTelephonyAccount(db: Db, organizationId: string): Promise<string | null> {
  const binding = await getProviderBinding(db, { organizationId, providerKey: telephonyProviderKey() });
  return binding?.status === 'active' ? binding.externalAccountId : null;
}

/**
 * A call, as business record.
 *
 * **Two facts on one row, and keeping them apart is what this file is for.** `status` is what
 * the telephone network did and every business on earth agrees on it. `outcome` is a judgement
 * one business makes in its own words. A system storing one column for both can report on
 * neither, which is the mistake every dialer schema this repository has read makes at least
 * once.
 *
 * **Placing and finishing are two acts, and the row is written twice on purpose.** At the moment
 * of dialling nobody knows anything: not how long it will last, not whether anyone answers, not
 * what was said. So the row is created with what is true then, and finished by whoever hangs up.
 */

export type Call = {
  id: string;
  customerId: string;
  direction: 'outbound' | 'inbound';
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  /** The tenant's word for how it went, or null while nobody has said. */
  outcome: { id: string; name: string; reached: boolean } | null;
  note: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
};

// **One string literal, and it has to stay one.** supabase-js parses the select at the type
// level, so a string built by concatenation is `string` to the compiler and every row comes back
// as an error type. Hinted with the constraint name because the reference to call_outcomes is
// composite.
const CALL_SELECT =
  'id, customer_id, direction, status, from_number, to_number, note, started_at, ended_at, duration_seconds, outcome:call_outcomes!calls_outcome_same_org (id, name, reached)';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

type CallRow = {
  id: string;
  customer_id: string;
  direction: string;
  status: string;
  from_number: string;
  to_number: string;
  note: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  outcome: { id: string; name: string; reached: boolean } | { id: string; name: string; reached: boolean }[] | null;
};

function toCall(row: CallRow): Call {
  const outcome = one(row.outcome);
  return {
    id: row.id,
    customerId: row.customer_id,
    // The check constraints on both columns are what make these narrowings restatements of a
    // guarantee rather than assertions about a string.
    direction: row.direction as Call['direction'],
    status: row.status as CallStatus,
    fromNumber: row.from_number,
    toNumber: row.to_number,
    outcome: outcome ? { id: outcome.id, name: outcome.name, reached: outcome.reached } : null,
    note: row.note,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
  };
}

/** The floor's day: every call this business made or took, newest first. */
export async function listCalls(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<Call>> {
  const { data, error, count } = await db
    .from('calls')
    .select(CALL_SELECT, { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('started_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'calls.list_failed');
  }

  return counted((data ?? []).map(toCall), count);
}

/** One customer's calls, newest first. What a person reads before dialling again. */
export async function listCustomerCalls(
  db: Db,
  input: { organizationId: string; customerId: string; limit?: number },
): Promise<Call[]> {
  const { data, error } = await db
    .from('calls')
    .select(CALL_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('started_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'calls.list_failed');
  }

  return (data ?? []).map(toCall);
}

/**
 * Ring a customer into a room, and write down that it happened.
 *
 * **A conference rather than a two-party line, which is D38.** The customer joins a named room
 * and the agent's browser joins the same one. Hold, transfer, merge and a supervisor listening
 * in are then each one operation on somebody in that room, instead of four features that cannot
 * be added to a connected pair without dropping the call in front of the person being sold to.
 *
 * **The room is written down before anybody is rung.** `open_call` creates the call and both
 * expected legs in one transaction, so a conference can never exist at the carrier with nobody
 * recorded as being in it — and if the carrier then refuses, what is left is a call row that
 * failed rather than a room nothing knows about.
 *
 * **A deployment with no carrier configured is refused rather than silently logged.** The
 * opposite — record the row, skip the dialling — is the failure D31 names: somebody presses a
 * button, something appears on the screen, and no telephone rings anywhere. `recordCall` below
 * is how a call made on a mobile gets written down, and it is a different act with a different
 * name.
 */
export async function placeCall(
  db: Db,
  input: { organizationId: string; customerId: string; toNumber: string },
): Promise<{ callId: string; room: string }> {
  const actor = await requireActor(db);

  const to = input.toNumber.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(to)) {
    throw new DomainError(
      'That is not a number this platform can dial. It needs a country code, like +14165550142.',
      'calls.number_invalid',
    );
  }

  const reportTo = callbackBase();
  const actingAccount = await actingTelephonyAccount(db, input.organizationId);
  const provider = await telephonyProvider(actingAccount);
  if (!provider || !reportTo) {
    throw new DomainError(
      'This deployment cannot place calls yet. Record the call instead once you have made it.',
      'calls.telephony_unconfigured',
    );
  }

  // **The business's own number, not the deployment's.** This used to read one environment
  // variable for every tenant on the installation, which meant a business either dialled from
  // somebody else's number or from none. Two refusals rather than one, because they are two
  // different problems with two different people to fix them: the one above is ours, and this
  // one is a business that has not finished setting the module up (D31).
  const from = await callingNumber(db, { organizationId: input.organizationId });
  if (!from) {
    throw new DomainError(
      'This business has no number to dial from yet. Set one under Calls, in Set up.',
      'calls.no_calling_number',
    );
  }

  // Ours rather than the carrier's, because a participant has to be added to a room that
  // already has a name and there is nothing to ask. Unique per call and meaningless outside
  // this platform: a room named after a customer would put a customer's identity into a
  // vendor's logs.
  const room = `gold-${randomUUID()}`;

  const { data: callId, error } = await db.rpc('open_call', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_conference_name: room,
    p_from_number: from,
    p_to_number: to,
  });

  if (error) {
    // Refused by the policy on `calls`, which is where `call.place` is actually enforced —
    // `open_call` is security invoker and adds no authority of its own.
    throw new DomainError(
      error.code === '42501'
        ? 'Your role cannot place calls here.'
        : error.message,
      'calls.open_failed',
    );
  }

  // Outside the database on purpose: a carrier request inside a transaction would hold a
  // connection open for the length of somebody else's network.
  try {
    await provider.addToRoom({ room, from, to, reportTo });
  } catch (cause) {
    // The row exists and nobody is going to ring. Marked failed rather than left ringing
    // forever, because a floor reading its own history must not find calls that never happened
    // sitting in the same state as ones still in progress.
    await db
      .from('calls')
      .update({ status: 'failed', ended_at: new Date().toISOString() })
      .eq('id', callId as string)
      .eq('organization_id', input.organizationId);

    throw new DomainError(
      `The call could not be placed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'calls.dial_failed',
    );
  }

  return { callId: callId as string, room };
}

/**
 * A short-lived credential letting this person's browser be a telephone.
 *
 * **Minted per session, stored nowhere, and naming exactly one person.** The identity it carries
 * is this platform's own user id rather than anything the carrier knows, so a credential that
 * leaked would let somebody be *that agent* on that deployment's application and nothing else.
 *
 * It is not gated by `call.place` and must not be: holding a telephone is not making a call, and
 * the policy on `calls` is what refuses somebody who may not dial. A second check here would be
 * a second authorization system shadowing the real one (I12).
 */
export async function browserTelephoneToken(db: Db): Promise<string> {
  const actor = await requireActor(db);

  const provider = await telephonyProvider();
  if (!provider) {
    throw new DomainError(
      'This deployment cannot place calls yet.',
      'calls.telephony_unconfigured',
    );
  }

  return provider.browserToken({ identity: actor.id });
}

/**
 * Write down a call that happened somewhere else.
 *
 * The second caller, and a genuinely different act from the one above: a business dialling from
 * mobile phones has a call history worth keeping and no carrier in this deployment. It shares
 * `call.place` because deciding who may put this business in front of a customer is one
 * decision, however the ringing happened.
 */
export async function recordCall(
  db: Db,
  input: {
    organizationId: string;
    customerId: string;
    direction: 'outbound' | 'inbound';
    fromNumber: string;
    toNumber: string;
    startedAt?: string;
  },
): Promise<string> {
  const actor = await requireActor(db);

  for (const [label, value] of [
    ['from', input.fromNumber],
    ['to', input.toNumber],
  ] as const) {
    if (!/^\+[1-9][0-9]{7,14}$/.test(value.trim())) {
      throw new DomainError(
        `The ${label} number needs a country code, like +14165550142.`,
        'calls.number_invalid',
      );
    }
  }

  const { data, error } = await db
    .from('calls')
    .insert({
      organization_id: input.organizationId,
      customer_id: input.customerId,
      direction: input.direction,
      // Written down after the fact, so the network's part is over. `completed` is what a
      // person means by "I called them" — anything else is something they would have said.
      status: 'completed',
      from_number: input.fromNumber.trim(),
      to_number: input.toNumber.trim(),
      started_at: input.startedAt ?? new Date().toISOString(),
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    throw new DomainError(error.message, 'calls.record_failed');
  }

  await writeCallEvent(db, {
    organizationId: input.organizationId,
    customerId: input.customerId,
    actorId: actor.id,
    action: 'call.placed',
    payload: { call_id: data.id, direction: input.direction, to_number: input.toNumber.trim() },
  });

  return data.id;
}

/**
 * How it went, once somebody knows.
 *
 * The outcome is the tenant's word; the note is the person's own. Neither is required, because a
 * call somebody has not got round to writing up is an ordinary state and forcing a word out of
 * them produces a wrong one.
 */
export async function recordCallOutcome(
  db: Db,
  input: {
    organizationId: string;
    callId: string;
    outcomeId: string | null;
    note: string;
    durationSeconds?: number | null;
    status?: CallStatus;
  },
): Promise<void> {
  const actor = await requireActor(db);

  if (input.durationSeconds != null) {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 0) {
      throw new DomainError(
        'A call lasts a whole number of seconds.',
        'calls.duration_invalid',
      );
    }
  }

  const { data, error } = await db
    .from('calls')
    .update({
      outcome_id: input.outcomeId,
      note: input.note.trim(),
      duration_seconds: input.durationSeconds ?? null,
      status: input.status ?? 'completed',
      ended_at: new Date().toISOString(),
    })
    .eq('id', input.callId)
    .eq('organization_id', input.organizationId)
    .select('id, customer_id');

  if (error) {
    throw new DomainError(error.message, 'calls.outcome_failed');
  }

  const row = (data ?? [])[0];
  if (!row) {
    throw new DomainError(
      'That call is not yours to write up.',
      'calls.outcome_refused',
    );
  }

  await writeCallEvent(db, {
    organizationId: input.organizationId,
    customerId: row.customer_id,
    actorId: actor.id,
    action: 'call.wrapped_up',
    payload: { call_id: row.id, outcome_id: input.outcomeId },
  });
}

/**
 * One event writer for three callers, extracted rather than copied.
 *
 * **Written against the customer rather than against the call**, which is the whole reason a
 * call shows up on a customer's timeline without a line of new SQL: `customer_activity` resolves
 * an event to a customer by its own entity id, so an event about a customer *is* one. An event
 * written against the call would need that view taught a fourth way to find its subject.
 */
async function writeCallEvent(
  db: Db,
  input: {
    organizationId: string;
    customerId: string;
    actorId: string;
    action: string;
    payload: Record<string, string | null>;
  },
): Promise<void> {
  const { error } = await db.from('events').insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    entity_type: 'customer',
    entity_id: input.customerId,
    action: input.action,
    payload: input.payload,
  });

  if (error) {
    throw new DomainError(error.message, 'calls.event_failed');
  }
}
