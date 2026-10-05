import { callbackBase, telephonyProvider, type CallStatus, type TelephonyProvider } from '@/lib/adapters/telephony';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { actingTelephonyAccount } from '@/lib/domain/reception/calls';
import { currentMembershipId } from '@/lib/domain/reception/inbox';

/**
 * Operations on a participant already in a room — the half of D38 a conference existing does not
 * give you for free. Everything here changes one leg; the conference itself, and every other leg
 * in it, is untouched by any one of these.
 *
 * **The carrier is asked first and the database is told after, and a carrier that does not answer
 * leaves the database as it was.** A screen that says someone is on hold, muted or gone must be
 * right about it: every operation here that reaches the carrier either completes there and is
 * recorded, or throws and records nothing. A leg the carrier has not yet named (a telephone still
 * being rung) cannot be controlled, and says so, rather than being flagged as if it had been.
 *
 * **Leaving a call and ending it are different acts.** An agent who started a call closes the room
 * by hanging up, so that a customer is never left talking to nobody. A transfer has to turn that
 * off first, or handing a call to a colleague drops it; `leaveCall` does exactly that, and every
 * removal does it too.
 */

export type ConferenceParty = 'agent' | 'customer' | 'supervisor' | 'transfer_target';

export type Participant = {
  id: string;
  callId: string;
  party: ConferenceParty;
  /** The member this leg belongs to, for an internal party; null for an outside telephone. */
  membershipId: string | null;
  /** Whether the carrier has named this leg yet. The identifier itself never leaves this layer. */
  connectable: boolean;
  status: CallStatus;
  onHold: boolean;
  muted: boolean;
  joinedAt: string | null;
  leftAt: string | null;
};

type ParticipantRow = {
  id: string;
  call_id: string;
  party: string;
  membership_id: string | null;
  external_id: string | null;
  status: string;
  on_hold: boolean;
  muted: boolean;
  joined_at: string | null;
  left_at: string | null;
};

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    callId: row.call_id,
    party: row.party as ConferenceParty,
    membershipId: row.membership_id,
    connectable: row.external_id !== null,
    status: row.status as CallStatus,
    onHold: row.on_hold,
    muted: row.muted,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

const PARTICIPANT_SELECT = 'id, call_id, party, membership_id, external_id, status, on_hold, muted, joined_at, left_at';

async function readLegs(db: Db, input: { organizationId: string; callId: string }): Promise<(ParticipantRow)[]> {
  const { data, error } = await db
    .from('call_participants')
    .select(PARTICIPANT_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('call_id', input.callId)
    .order('created_at', { ascending: true });

  if (error) throw new DomainError(error.message, 'conference.participants_failed');
  return data ?? [];
}

/** Every leg of one call, oldest first — the roster an active-call screen renders. */
export async function listCallParticipants(
  db: Db,
  input: { organizationId: string; callId: string },
): Promise<Participant[]> {
  return (await readLegs(db, input)).map(toParticipant);
}

type CallContext = { room: string; businessNumber: string; ended: boolean };

/** The room, the number it is on and whether it is still going — read before anything reaches the carrier. */
async function callContext(db: Db, input: { organizationId: string; callId: string }): Promise<CallContext> {
  const { data, error } = await db
    .from('calls')
    .select('conference_name, direction, from_number, to_number, status')
    .eq('organization_id', input.organizationId)
    .eq('id', input.callId)
    .maybeSingle();

  if (error) throw new DomainError(error.message, 'conference.call_failed');
  if (!data) throw new DomainError('That call is not here.', 'conference.no_call');
  if (!data.conference_name) {
    throw new DomainError('This call has no room to change.', 'conference.no_room');
  }
  return {
    room: data.conference_name,
    businessNumber: (data.direction === 'outbound' ? data.from_number : data.to_number) ?? '',
    ended: ['completed', 'failed', 'no_answer', 'busy'].includes(data.status),
  };
}

function requireLive(context: CallContext): void {
  if (context.ended) throw new DomainError('That call has already ended.', 'conference.call_ended');
}

async function carrier(db: Db, organizationId: string): Promise<TelephonyProvider> {
  const provider = await telephonyProvider(await actingTelephonyAccount(db, organizationId));
  if (!provider) {
    throw new DomainError('This deployment cannot place calls yet.', 'conference.telephony_unconfigured');
  }
  return provider;
}

/** A leg that can be controlled: present, still on the call, and already named by the carrier. */
async function controllableLeg(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string },
): Promise<ParticipantRow & { external_id: string }> {
  const leg = (await readLegs(db, input)).find((row) => row.id === input.participantId);
  if (!leg || leg.left_at !== null) {
    throw new DomainError('That participant is not on this call.', 'conference.no_participant');
  }
  if (!leg.external_id) {
    throw new DomainError('That participant is not connected yet.', 'conference.not_connected');
  }
  return leg as ParticipantRow & { external_id: string };
}

function carrierFailure(prefix: string, code: string, cause: unknown): DomainError {
  return new DomainError(`${prefix}: ${cause instanceof Error ? cause.message : String(cause)}`, code);
}

function staffOrCallerError(error: { code?: string; message: string }, action: string): DomainError {
  return new DomainError(
    error.code === '42501' ? `Your role cannot ${action}.` : error.message,
    'conference.write_failed',
  );
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * Ring another party into a conference that already exists — an additional agent, a supervisor
 * listening in, or a transfer's destination. The room is not created here; it already has a
 * customer and an agent in it, or this call would not exist (D38, `open_call`). The party is
 * recorded before the carrier is asked, so a telephone ringing is always one something knows about;
 * if the carrier refuses, the party is withdrawn again and the call carries on as it was.
 */
export async function addCallParticipant(
  db: Db,
  input: { organizationId: string; callId: string; party: 'agent' | 'supervisor' | 'transfer_target'; toNumber: string },
): Promise<{ participantId: string }> {
  const to = input.toNumber.trim();
  if (!E164.test(to)) {
    throw new DomainError(
      'That is not a number this platform can dial. It needs a country code, like +14165550142.',
      'conference.number_invalid',
    );
  }

  const reportTo = callbackBase();
  const provider = await carrier(db, input.organizationId);
  if (!reportTo) {
    throw new DomainError('This deployment cannot place calls yet.', 'conference.telephony_unconfigured');
  }

  const context = await callContext(db, input);
  requireLive(context);
  if (!context.businessNumber) {
    throw new DomainError('This call has no number of its own to ring from.', 'conference.no_calling_number');
  }

  const { data: participantId, error } = await db.rpc('add_call_participant', {
    p_organization_id: input.organizationId,
    p_call_id: input.callId,
    p_party: input.party,
  });
  if (error) throw staffOrCallerError(error, 'add a participant to this call');
  const added = participantId as string;

  const withdraw = () =>
    db.rpc('remove_call_participant', { p_organization_id: input.organizationId, p_participant_id: added });

  let placed;
  try {
    placed = await provider.addToRoom({ room: context.room, from: context.businessNumber, to, reportTo });
  } catch (cause) {
    await withdraw();
    throw carrierFailure('Could not add that participant', 'conference.add_failed', cause);
  }

  const { error: learnError } = await db.rpc('set_call_leg_provider_id', {
    p_organization_id: input.organizationId,
    p_participant_id: added,
    p_external_id: placed.externalId,
  });
  if (learnError) {
    // Ringing a telephone nobody can track: hang it up, and say so.
    await provider
      .updateParticipant({ room: context.room, externalId: placed.externalId, status: 'completed' })
      .catch(() => undefined);
    await withdraw();
    throw new DomainError('Could not add that participant, so they were disconnected.', 'conference.add_untracked');
  }

  return { participantId: added };
}

/**
 * End one leg. The conference survives for everybody still in it — the entire reason D38 chose a
 * room over a two-party line: leaving is one operation on one participant, not a second call.
 * Turning off "ends the room when this leg leaves" first is what makes that true of the agent
 * who started it.
 */
export async function removeCallParticipant(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string },
): Promise<void> {
  const context = await callContext(db, input);
  requireLive(context);
  const leg = await controllableLeg(db, input);
  const provider = await carrier(db, input.organizationId);

  try {
    await provider.updateParticipant({ room: context.room, externalId: leg.external_id, endsRoomOnExit: false });
    await provider.updateParticipant({ room: context.room, externalId: leg.external_id, status: 'completed' });
  } catch (cause) {
    throw carrierFailure('Could not remove that participant', 'conference.remove_failed', cause);
  }

  const { error } = await db.rpc('remove_call_participant', {
    p_organization_id: input.organizationId,
    p_participant_id: input.participantId,
  });
  if (error) throw staffOrCallerError(error, 'remove a participant from this call');
}

/** Hold or resume one leg — the person on it hears hold music and hears nobody, and nobody hears them. */
export async function setParticipantHold(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string; hold: boolean },
): Promise<void> {
  const context = await callContext(db, input);
  requireLive(context);
  const leg = await controllableLeg(db, input);
  const provider = await carrier(db, input.organizationId);

  try {
    await provider.updateParticipant({ room: context.room, externalId: leg.external_id, hold: input.hold });
  } catch (cause) {
    throw carrierFailure('Could not change hold', 'conference.hold_failed', cause);
  }

  const { error } = await db.rpc('set_participant_hold', {
    p_organization_id: input.organizationId,
    p_participant_id: input.participantId,
    p_hold: input.hold,
  });
  if (error) throw staffOrCallerError(error, 'change hold on this call');
}

/** Mute or unmute one leg's own microphone in the conference mix. */
export async function setParticipantMuted(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string; muted: boolean },
): Promise<void> {
  const context = await callContext(db, input);
  requireLive(context);
  const leg = await controllableLeg(db, input);
  const provider = await carrier(db, input.organizationId);

  try {
    await provider.updateParticipant({ room: context.room, externalId: leg.external_id, muted: input.muted });
  } catch (cause) {
    throw carrierFailure('Could not change mute', 'conference.mute_failed', cause);
  }

  const { error } = await db.rpc('set_participant_muted', {
    p_organization_id: input.organizationId,
    p_participant_id: input.participantId,
    p_muted: input.muted,
  });
  if (error) throw staffOrCallerError(error, 'change mute on this call');
}

/** The leg of the person asking: their own, on this call, still present. */
async function ownAgentLeg(db: Db, input: { organizationId: string; callId: string }): Promise<ParticipantRow> {
  const membershipId = await currentMembershipId(db, { organizationId: input.organizationId });
  const leg = (await readLegs(db, input)).find(
    (row) => row.membership_id !== null && row.membership_id === membershipId && row.left_at === null,
  );
  if (!leg) throw new DomainError('You are not on this call.', 'conference.not_on_call');
  return leg;
}

/**
 * Stop this person's own telephone closing the room when it hangs up. Called by the browser just
 * before it disconnects, when somebody else is staying on the call — otherwise hanging up *is*
 * ending the call, and the customer is not left talking to nobody.
 */
export async function leaveCall(db: Db, input: { organizationId: string; callId: string }): Promise<void> {
  const context = await callContext(db, input);
  requireLive(context);
  const leg = await ownAgentLeg(db, input);
  if (!leg.external_id) throw new DomainError('You are not connected yet.', 'conference.not_connected');
  const provider = await carrier(db, input.organizationId);
  try {
    await provider.updateParticipant({ room: context.room, externalId: leg.external_id, endsRoomOnExit: false });
  } catch (cause) {
    throw carrierFailure('Could not leave the call', 'conference.leave_failed', cause);
  }
}

/**
 * End the whole business call: every telephone in the room is hung up. A call that nobody ever
 * answered is also settled here, because no carrier will report on a room that never started; an
 * answered one ends when the carrier reports its last leg gone, as it always does.
 */
export async function endCall(db: Db, input: { organizationId: string; callId: string }): Promise<void> {
  const context = await callContext(db, input);
  if (context.ended) return;
  const provider = await carrier(db, input.organizationId);
  const failures: unknown[] = [];
  for (const leg of await readLegs(db, input)) {
    if (leg.left_at !== null || !leg.external_id) continue;
    await provider
      .updateParticipant({ room: context.room, externalId: leg.external_id, status: 'completed' })
      .catch((cause) => failures.push(cause));
  }
  // Refused, harmlessly, for a call somebody answered: the carrier will say when it is over.
  await db.rpc('fail_call_attempt', { p_organization_id: input.organizationId, p_call_id: input.callId });
  if (failures.length > 0) throw carrierFailure('Could not hang up every line', 'conference.end_failed', failures[0]);
}

async function waitForTarget(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string; timeoutMs: number },
): Promise<'connected' | 'unavailable'> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const leg = (await readLegs(db, input)).find((row) => row.id === input.participantId);
    if (!leg || leg.left_at !== null) return 'unavailable';
    if (leg.status === 'in_progress') return 'connected';
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return 'unavailable';
}

/**
 * Warm transfer: ring the destination into the room and keep the transferring agent in it, with
 * the customer put on hold, so the agent can speak to the destination first. The same call, with
 * one more person on it. `completeTransfer` then hands it over; `cancelTransfer` takes it back.
 */
export async function warmTransfer(
  db: Db,
  input: { organizationId: string; callId: string; toNumber: string },
): Promise<{ participantId: string }> {
  const added = await addCallParticipant(db, { ...input, party: 'transfer_target' });
  const customer = (await readLegs(db, input)).find((row) => row.party === 'customer' && row.left_at === null);
  if (customer?.external_id && !customer.on_hold) {
    // The customer waits while the two agents talk. If the carrier cannot hold them, the transfer
    // still stands and the customer simply hears the conversation, which is a thing to know
    // rather than a reason to refuse.
    await setParticipantHold(db, { ...input, participantId: customer.id, hold: true }).catch(() => undefined);
  }
  return added;
}

/** Hand a warm transfer over: the customer comes off hold and this agent leaves, the call carrying on. */
export async function completeTransfer(db: Db, input: { organizationId: string; callId: string }): Promise<void> {
  const legs = await readLegs(db, input);
  const target = legs.find((row) => row.party === 'transfer_target' && row.left_at === null);
  if (!target || target.status !== 'in_progress') {
    throw new DomainError('The person you are transferring to has not answered yet.', 'conference.target_not_connected');
  }
  const customer = legs.find((row) => row.party === 'customer' && row.left_at === null);
  if (customer?.on_hold) {
    await setParticipantHold(db, { ...input, participantId: customer.id, hold: false });
  }
  await leaveCall(db, input);
}

/** Abandon a warm transfer: the destination is hung up on and the customer comes back off hold. */
export async function cancelTransfer(db: Db, input: { organizationId: string; callId: string }): Promise<void> {
  const legs = await readLegs(db, input);
  const target = legs.find((row) => row.party === 'transfer_target' && row.left_at === null);
  if (target?.external_id) await removeCallParticipant(db, { ...input, participantId: target.id });
  const customer = legs.find((row) => row.party === 'customer' && row.left_at === null);
  if (customer?.on_hold) await setParticipantHold(db, { ...input, participantId: customer.id, hold: false });
}

/**
 * Cold transfer: ring the destination in, and release the transferring agent only once they have
 * answered — the customer and the new party stay connected on the same call. If the destination
 * never picks up, the agent is still there and the customer never noticed: the transfer failed and
 * the call did not.
 */
export async function coldTransfer(
  db: Db,
  input: { organizationId: string; callId: string; toNumber: string; waitMs?: number },
): Promise<{ participantId: string }> {
  const target = await addCallParticipant(db, {
    organizationId: input.organizationId,
    callId: input.callId,
    party: 'transfer_target',
    toNumber: input.toNumber,
  });

  const outcome = await waitForTarget(db, {
    organizationId: input.organizationId,
    callId: input.callId,
    participantId: target.participantId,
    timeoutMs: input.waitMs ?? 25_000,
  });

  if (outcome !== 'connected') {
    await removeCallParticipant(db, {
      organizationId: input.organizationId,
      callId: input.callId,
      participantId: target.participantId,
    }).catch(() => undefined);
    throw new DomainError(
      'The person you are transferring to did not answer. You are still on the call.',
      'conference.transfer_unanswered',
    );
  }

  await leaveCall(db, { organizationId: input.organizationId, callId: input.callId });
  return target;
}
