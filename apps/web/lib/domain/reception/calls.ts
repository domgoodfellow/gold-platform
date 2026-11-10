import {
  callbackBase,
  telephonyProvider,
  telephonyProviderKey,
  type CallStatus,
} from '@/lib/adapters/telephony';
import { randomUUID } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { getProviderBinding } from '@/lib/domain/providers/bindings';
import { resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The scope a business's own calls happen inside, or `null` for one with no telephony binding
 * yet — which is every business until staff provisions one, and `telephonyProvider` reads that
 * exactly like GOLD's master scope, unchanged.
 */
export async function actingTelephonyAccount(db: Db, organizationId: string): Promise<string | null> {
  const binding = await getProviderBinding(db, { organizationId, providerKey: telephonyProviderKey() });
  return binding?.status === 'active' ? binding.externalAccountId : null;
}

/**
 * A call, as business record: **one call, however many telephones were in it.**
 *
 * **Two facts on one row, and keeping them apart is what this file is for.** `status` is what
 * the telephone network did and every business on earth agrees on it. `outcome` is a judgement
 * one business makes in its own words. A system storing one column for both can report on
 * neither, which is the mistake every dialer schema this repository has read makes at least
 * once.
 *
 * **A leg is not a call.** A conference has a telephone per person in it, each with its own
 * carrier identifier, and the business call is settled from all of them by the database: it is
 * answered when two legs are connected, and it ends when the last one leaves. Nothing here holds
 * a carrier identifier, and nothing above this file ever sees one.
 *
 * **Unknown callers are calls.** `customerId` is null until exactly one customer holds the
 * number (the rule a conversation uses) or a person says who it was. Nothing is created.
 */

export type CallDirection = 'outbound' | 'inbound';
export type CallContact = { id: string; name: string; email: string | null; phone: string | null };

/** At most two canonical matches: enough to distinguish a unique contact from ambiguity. */
export async function dialerContactCandidates(db: Db, input: { organizationId: string; number: string }): Promise<CallContact[]> {
  const { data, error } = await db.rpc('dialer_contact_candidates', { p_organization_id: input.organizationId, p_number: input.number });
  if (error) throw fromDatabaseError(error, 'calls.contact_lookup_failed');
  return data ?? [];
}

export type Call = {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  customerId: string | null;
  /** The linked customer's name, or null for an unknown caller. */
  customerName: string | null;
  /** The number on the business's side, as recorded. */
  fromNumber: string | null;
  toNumber: string;
  /** The number on the other side. Null only for an inbound call whose caller withheld it. */
  externalNumber: string | null;
  /** Which of the business's numbers it was on, when that number is in the inventory. */
  phoneNumberId: string | null;
  /** The tenant's word for how it went, or null while nobody has said. */
  outcome: { id: string; name: string; reached: boolean } | null;
  note: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  hasRecording: boolean;
  /** The people from this business who were on it. */
  handledBy: { membershipId: string; name: string }[];
};

// **One string literal, and it has to stay one.** supabase-js parses the select at the type
// level, so a string built by concatenation is `string` to the compiler and every row comes back
// as an error type. Hinted with the constraint names because every reference here is composite.
const CALL_SELECT =
  'id, customer_id, direction, status, from_number, to_number, phone_number_id, note, started_at, answered_at, ended_at, duration_seconds, recording_available_at, ' +
  'outcome:call_outcomes!calls_outcome_same_org (id, name, reached), ' +
  'customer:contacts!calls_customer_same_org (name), ' +
  'legs:call_participants!call_participants_call_same_org (membership_id, party, membership:memberships!call_participants_membership_same_org (display_name))';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

type CallRow = {
  id: string;
  customer_id: string | null;
  direction: string;
  status: string;
  from_number: string | null;
  to_number: string;
  phone_number_id: string | null;
  note: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_available_at: string | null;
  outcome: { id: string; name: string; reached: boolean } | { id: string; name: string; reached: boolean }[] | null;
  customer: { name: string } | { name: string }[] | null;
  legs: { membership_id: string | null; party: string; membership: { display_name: string } | { display_name: string }[] | null }[] | null;
};

function toCall(row: CallRow): Call {
  const outcome = one(row.outcome);
  const direction = row.direction as CallDirection;
  const seen = new Set<string>();
  const handledBy: Call['handledBy'] = [];
  for (const leg of row.legs ?? []) {
    if (!leg.membership_id || seen.has(leg.membership_id)) continue;
    seen.add(leg.membership_id);
    handledBy.push({ membershipId: leg.membership_id, name: one(leg.membership)?.display_name ?? 'Someone' });
  }
  return {
    id: row.id,
    direction,
    // The check constraint on the column is what makes this narrowing a restatement of a
    // guarantee rather than an assertion about a string.
    status: row.status as CallStatus,
    customerId: row.customer_id,
    customerName: one(row.customer)?.name ?? null,
    fromNumber: row.from_number,
    toNumber: row.to_number,
    externalNumber: direction === 'inbound' ? row.from_number : row.to_number,
    phoneNumberId: row.phone_number_id,
    outcome: outcome ? { id: outcome.id, name: outcome.name, reached: outcome.reached } : null,
    note: row.note,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    hasRecording: row.recording_available_at !== null,
    handledBy,
  };
}

/**
 * What the status of a call is called to a person. The carrier's words never reach a screen, and an
 * inbound call nobody picked up is *missed* — which is the business's loss, where the same status
 * on a call it placed is the other person's choice.
 */
export function callStatusLabel(call: { status: CallStatus; direction: CallDirection }): string {
  switch (call.status) {
    case 'ringing':
      return 'Ringing';
    case 'in_progress':
      return 'In call';
    case 'completed':
      return 'Completed';
    case 'no_answer':
      return call.direction === 'inbound' ? 'Missed' : 'No answer';
    case 'busy':
      return 'Busy';
    case 'failed':
      return 'Failed';
  }
}

/** The floor's day: the most recent calls this business made or took, newest first. */
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
    throw fromDatabaseError(error, 'calls.list_failed');
  }

  return counted(((data ?? []) as unknown as CallRow[]).map(toCall), count);
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
    throw fromDatabaseError(error, 'calls.list_failed');
  }

  return ((data ?? []) as unknown as CallRow[]).map(toCall);
}

/** Which calls to list. One value per axis; all optional. */
export type CallFilter = {
  search?: string;
  direction?: CallDirection;
  /** `missed` is an inbound call nobody answered; `active` is one still ringing or connected. */
  state?: 'active' | 'missed' | CallStatus;
  phoneNumberId?: string;
  /** Calls this member was on. */
  membershipId?: string;
  customerId?: string;
  /** Only conversations that have not been written up with an outcome yet — a call nobody answered has nothing to say. */
  needsWrapUp?: boolean;
  needsFollowUp?: boolean;
  since?: string;
  until?: string;
};

export type CallPage = { items: Call[]; nextCursor: string | null; total?: number };

export const CALL_PAGE_SIZE = 25;

/** The cursor is the last row's position in the (started, id) order, so a page boundary can never skip or repeat a row. */
function encodeCursor(row: { startedAt: string; id: string }): string {
  return `${row.startedAt}|${row.id}`;
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = cursor.split('|');
  if (!at || !id) throw new DomainError('That page of calls is not valid.', 'calls.cursor_invalid');
  return { at, id };
}

/**
 * One page of the calls workspace, newest first. Every filter narrows in the database, on the
 * indexes made for it; nothing is downloaded and cut down in the browser. Another business's calls
 * are in no result for any filter, because RLS and the organization filter both say so.
 */
export async function listCallPage(
  db: Db,
  input: { organizationId: string; filter?: CallFilter; cursor?: string | null; limit?: number },
): Promise<CallPage> {
  const filter = input.filter ?? {};
  const limit = Math.min(Math.max(input.limit ?? CALL_PAGE_SIZE, 1), 100);

  // `!inner` makes the embedded filter narrow the calls themselves rather than just the legs shown.
  const select = filter.membershipId
    ? CALL_SELECT.replace('legs:call_participants!call_participants_call_same_org', 'legs:call_participants!call_participants_call_same_org!inner')
    : CALL_SELECT;
  let query = db.from('calls').select(select, { count: 'exact' }).eq('organization_id', input.organizationId);
  const search = filter.search?.replace(/[^\p{L}\p{N} @+._-]/gu, '').slice(0, 100).trim();
  if (search) query = query.or(`from_number.ilike.%${search}%,to_number.ilike.%${search}%,note.ilike.%${search}%`);

  if (filter.direction) query = query.eq('direction', filter.direction);
  if (filter.state === 'missed') query = query.eq('direction', 'inbound').in('status', ['no_answer', 'busy', 'failed']);
  else if (filter.state === 'active') query = query.in('status', ['ringing', 'in_progress']);
  else if (filter.state) query = query.eq('status', filter.state);
  if (filter.phoneNumberId) query = query.eq('phone_number_id', filter.phoneNumberId);
  if (filter.customerId) query = query.eq('customer_id', filter.customerId);
  if (filter.needsWrapUp) query = query.is('outcome_id', null).eq('status', 'completed');
  if (filter.needsFollowUp) query = query.is('outcome_id', null).eq('direction', 'inbound').in('status', ['no_answer', 'busy', 'failed']);
  if (filter.since) query = query.gte('started_at', filter.since);
  if (filter.until) query = query.lt('started_at', filter.until);
  if (filter.membershipId) query = query.eq('legs.membership_id', filter.membershipId);

  if (input.cursor) {
    const { at, id } = decodeCursor(input.cursor);
    query = query.or(`started_at.lt."${at}",and(started_at.eq."${at}",id.lt.${id})`);
  }

  const { data, error, count } = await query
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw fromDatabaseError(error, 'calls.list_failed');

  const rows = (data ?? []) as unknown as CallRow[];
  const page = rows.slice(0, limit).map(toCall);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeCursor(last) : null, total: count ?? undefined };
}

export type CallCounts = { active: number; today: number; missedToday: number; needsWrapUp: number };

/** The four numbers the Calls workspace opens with, each counted by the database rather than from a page of rows. */
export async function getCallCounts(
  db: Db,
  input: { organizationId: string; dayStart: string; dayEnd: string },
): Promise<CallCounts> {
  const base = () => db.from('calls').select('id', { count: 'exact', head: true }).eq('organization_id', input.organizationId);
  const [active, today, missed, wrap] = await Promise.all([
    base().in('status', ['ringing', 'in_progress']),
    base().gte('started_at', input.dayStart).lt('started_at', input.dayEnd),
    base().gte('started_at', input.dayStart).lt('started_at', input.dayEnd).eq('direction', 'inbound').in('status', ['no_answer', 'busy', 'failed']),
    base().is('outcome_id', null).eq('status', 'completed'),
  ]);
  for (const result of [active, today, missed, wrap]) {
    if (result.error) throw fromDatabaseError(result.error, 'calls.counts_failed');
  }
  return { active: active.count ?? 0, today: today.count ?? 0, missedToday: missed.count ?? 0, needsWrapUp: wrap.count ?? 0 };
}

export type CallParty = 'agent' | 'customer' | 'supervisor' | 'transfer_target';

/** Someone who was on the call, in the business's terms: no carrier identifier is carried. */
export type CallLeg = {
  id: string;
  party: CallParty;
  /** The member's name for an internal party; null for an outside telephone. */
  name: string | null;
  status: CallStatus;
  onHold: boolean;
  joinedAt: string | null;
  leftAt: string | null;
};

export type CallDetail = Call & { legs: CallLeg[] };

const LEG_SELECT =
  'id, party, status, on_hold, joined_at, left_at, created_at, membership:memberships!call_participants_membership_same_org (display_name)';

/** One call with who was on it, or null when it is not in this organization. */
export async function getCall(
  db: Db,
  input: { organizationId: string; callId: string },
): Promise<CallDetail | null> {
  const { data, error } = await db
    .from('calls')
    .select(CALL_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('id', input.callId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'calls.read_failed');
  if (!data) return null;

  const { data: legs, error: legError } = await db
    .from('call_participants')
    .select(LEG_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('call_id', input.callId)
    .order('created_at', { ascending: true });
  if (legError) throw fromDatabaseError(legError, 'calls.read_failed');

  return {
    ...toCall(data as unknown as CallRow),
    legs: (legs ?? []).map((leg) => ({
      id: leg.id,
      party: leg.party as CallParty,
      name: one(leg.membership as { display_name: string } | { display_name: string }[] | null)?.display_name ?? null,
      status: leg.status as CallStatus,
      onHold: leg.on_hold,
      joinedAt: leg.joined_at,
      leftAt: leg.left_at,
    })),
  };
}

/**
 * Ring a number into a room, and write down that it happened.
 *
 * **A conference rather than a two-party line, which is the conference-call design.** The customer joins a named room
 * and the agent's browser joins the same one. Hold, transfer, merge and a supervisor listening
 * in are then each one operation on somebody in that room, instead of four features that cannot
 * be added to a connected pair without dropping the call in front of the person being sold to.
 *
 * **The number it rings from is chosen here and nowhere else.** The caller may name a number it
 * wants to use, and `resolve_outbound_number` answers whether this person may; a number nobody
 * resolved is never dialled from. The browser supplies a recipient and, at most, a number's id.
 *
 * **The room is written down before anybody is rung.** `open_call` creates the call and both
 * expected legs in one transaction, so a conference can never exist at the carrier with nobody
 * recorded as being in it — and if the carrier then refuses, what is left is a call row that
 * failed rather than a room nothing knows about.
 *
 * **A deployment with no carrier configured is refused rather than silently logged.** The
 * opposite — record the row, skip the dialling — is the failure the no-dead-end rule names: somebody presses a
 * button, something appears on the screen, and no telephone rings anywhere. `recordCall` below
 * is how a call made on a mobile gets written down, and it is a different act with a different
 * name.
 */
export async function placeCall(
  db: Db,
  input: { organizationId: string; customerId?: string | null; toNumber: string; phoneNumberId?: string | null },
): Promise<{ callId: string; room: string }> {
  await requireActor(db);

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
      'Calling from GildOps isn’t available yet. Log the call once you have made it.',
      'calls.telephony_unconfigured',
    );
  }

  const from = await resolveOutboundNumber(db, {
    organizationId: input.organizationId,
    phoneNumberId: input.phoneNumberId,
  });
  if (!from) {
    throw new DomainError(
      input.phoneNumberId
        ? 'You cannot call from that number. Choose one of yours, or ask for it to be assigned to you.'
        : 'There is no number for you to call from yet. Assign one under Numbers, or set one under Calls, in Set up.',
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
    // Null is a number nobody has recorded; the database links it only if exactly one customer holds it.
    p_customer_id: (input.customerId ?? null) as string,
    p_conference_name: room,
    p_from_number: from.e164,
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

  const placedCallId = callId as string;
  const failAttempt = () =>
    db.rpc('fail_call_attempt', { p_organization_id: input.organizationId, p_call_id: placedCallId });

  // Outside the database on purpose: a carrier request inside a transaction would hold a
  // connection open for the length of somebody else's network.
  let placed;
  try {
    placed = await provider.addToRoom({ room, from: from.e164, to, reportTo });
  } catch (cause) {
    // The row exists and nobody is going to ring. Marked failed rather than left ringing
    // forever, because a floor reading its own history must not find calls that never happened
    // sitting in the same state as ones still in progress.
    await failAttempt();

    throw new DomainError(
      `The call could not be placed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'calls.dial_failed',
    );
  }

  // The carrier's identifier for the customer's telephone is what its later callbacks name, so a
  // call that cannot remember it can never learn it ended. Better refused now than ringing forever.
  const learned = await rememberCustomerLeg(db, input.organizationId, placedCallId, placed.externalId);
  if (!learned) {
    await provider
      .updateParticipant({ room, externalId: placed.externalId, status: 'completed' })
      .catch(() => undefined);
    await failAttempt();
    throw new DomainError(
      'The call was started but could not be tracked, so it was ended. Try again.',
      'calls.dial_untracked',
    );
  }

  return { callId: placedCallId, room };
}

async function rememberCustomerLeg(db: Db, organizationId: string, callId: string, externalId: string): Promise<boolean> {
  const { data, error } = await db
    .from('call_participants')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('call_id', callId)
    .eq('party', 'customer')
    .maybeSingle();
  if (error || !data) return false;
  const { error: writeError } = await db.rpc('set_call_leg_provider_id', {
    p_organization_id: organizationId,
    p_participant_id: data.id,
    p_external_id: externalId,
  });
  return !writeError;
}

/**
 * A short-lived credential letting this person's browser be a telephone.
 *
 * **Minted per session, stored nowhere, and naming exactly one membership.** The identity it carries
 * is this person's membership in the organization they are working in, resolved here from their own
 * session — not a user id, which is the same in every business, and not anything the browser sends.
 * A credential that leaked would let somebody be *that member* on that deployment's application and
 * nothing else.
 *
 * It is not gated by `call.place` and must not be: holding a telephone is not making a call, and
 * the policy on `calls` is what refuses somebody who may not dial. A second check here would be
 * a second authorization system shadowing the real one.
 *
 * The credential is signed by the deployment's own key; a per-business key is not built, so
 * the browser's *scope* is the deployment's and it names no account of its own.
 */
export async function browserTelephoneToken(db: Db, input: { organizationId: string }): Promise<string> {
  await requireActor(db);

  const membershipId = await currentMembershipId(db, { organizationId: input.organizationId });
  if (!membershipId) {
    throw new DomainError('You are not a member of this business.', 'calls.not_a_member');
  }

  const provider = await telephonyProvider();
  if (!provider) {
    throw new DomainError(
      'Calling from GildOps isn’t available yet.',
      'calls.telephony_unconfigured',
    );
  }

  return provider.browserToken({ identity: membershipId });
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
      // Let Postgres own "now" when the caller did not provide a historical instant. The
      // wrap-up RPC also uses database time; mixing the app and database clocks can otherwise
      // make an immediately wrapped call appear to end milliseconds before it started.
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    throw fromDatabaseError(error, 'calls.record_failed');
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

/** Say who an unknown caller was. Only a call with no customer yet, and only to one of this business's own. */
export async function linkCallCustomer(
  db: Db,
  input: { organizationId: string; callId: string; customerId: string },
): Promise<void> {
  const { error } = await db.rpc('link_call_customer', {
    p_organization_id: input.organizationId,
    p_call_id: input.callId,
    p_customer_id: input.customerId,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'That call already has a customer, or your role cannot link it.' : error.message,
      'calls.link_failed',
    );
  }
}

/**
 * The audio of one call, for somebody who may play it. The carrier's reference is read through a
 * door that checks who is asking and is fetched with this platform's own credentials; it is never
 * handed to the person, because it is not authorization and an obscure address is not a lock.
 */
export async function getCallRecording(
  db: Db,
  input: { organizationId: string; callId: string },
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const { data, error } = await db.rpc('call_recording_reference', {
    p_organization_id: input.organizationId,
    p_call_id: input.callId,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Your role cannot play recordings.' : error.message,
      'calls.recording_refused',
    );
  }
  if (!data) return null;

  const provider = await telephonyProvider(await actingTelephonyAccount(db, input.organizationId));
  if (!provider) {
    throw new DomainError('Recordings aren’t available yet.', 'calls.telephony_unconfigured');
  }
  return provider.fetchRecording({ reference: data as string });
}

/**
 * One event writer, extracted rather than copied.
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
    throw fromDatabaseError(error, 'calls.event_failed');
  }
}
