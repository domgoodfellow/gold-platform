import { callbackBase, telephonyProvider, telephonyProviderKey, type CallStatus } from '@/lib/adapters/telephony';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getProviderBinding } from '@/lib/domain/providers/bindings';
import { callingNumber } from '@/lib/domain/reception/telephony';

/**
 * Operations on a participant already in a room — the half of D38 a conference existing does not
 * give you for free. Everything here changes one leg; the conference itself, and every other leg
 * in it, is untouched by any one of these.
 */

export type ConferenceParty = 'agent' | 'customer' | 'supervisor' | 'transfer_target';

export type Participant = {
  id: string;
  callId: string;
  party: ConferenceParty;
  externalId: string | null;
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
    externalId: row.external_id,
    status: row.status as CallStatus,
    onHold: row.on_hold,
    muted: row.muted,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

const PARTICIPANT_SELECT = 'id, call_id, party, external_id, status, on_hold, muted, joined_at, left_at';

/** Every leg of one call, oldest first — the roster an active-call screen renders. */
export async function listCallParticipants(
  db: Db,
  input: { organizationId: string; callId: string },
): Promise<Participant[]> {
  const { data, error } = await db
    .from('call_participants')
    .select(PARTICIPANT_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('call_id', input.callId)
    .order('joined_at', { ascending: true });

  if (error) throw new DomainError(error.message, 'conference.participants_failed');
  return (data ?? []).map(toParticipant);
}

async function actingTelephonyAccount(db: Db, organizationId: string): Promise<string | null> {
  const binding = await getProviderBinding(db, { organizationId, providerKey: telephonyProviderKey() });
  return binding?.status === 'active' ? binding.externalAccountId : null;
}

/** The room name and current legs a mutation needs before it can reach the carrier. */
async function callContext(
  db: Db,
  input: { organizationId: string; callId: string },
): Promise<{ room: string }> {
  const { data, error } = await db
    .from('calls')
    .select('conference_name')
    .eq('organization_id', input.organizationId)
    .eq('id', input.callId)
    .maybeSingle();

  if (error) throw new DomainError(error.message, 'conference.call_failed');
  if (!data?.conference_name) {
    throw new DomainError('This call has no room to change.', 'conference.no_room');
  }
  return { room: data.conference_name };
}

function staffOrCallerError(error: { code?: string; message: string }, action: string): DomainError {
  return new DomainError(
    error.code === '42501' ? `Your role cannot ${action}.` : error.message,
    'conference.write_failed',
  );
}

/**
 * Ring a fourth party into a conference that already exists — an additional agent, a supervisor
 * listening in, or a warm transfer's destination. The room is not created here; it already has a
 * customer and an agent in it, or this call would not exist (D38, `open_call`).
 */
export async function addCallParticipant(
  db: Db,
  input: { organizationId: string; callId: string; party: 'agent' | 'supervisor' | 'transfer_target'; toNumber: string },
): Promise<{ participantId: string }> {
  const to = input.toNumber.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(to)) {
    throw new DomainError(
      'That is not a number this platform can dial. It needs a country code, like +14165550142.',
      'conference.number_invalid',
    );
  }

  const reportTo = callbackBase();
  const actingAccount = await actingTelephonyAccount(db, input.organizationId);
  const provider = await telephonyProvider(actingAccount);
  if (!provider || !reportTo) {
    throw new DomainError('This deployment cannot place calls yet.', 'conference.telephony_unconfigured');
  }

  const from = await callingNumber(db, { organizationId: input.organizationId });
  if (!from) {
    throw new DomainError('This business has no number to dial from yet.', 'conference.no_calling_number');
  }

  const { room } = await callContext(db, input);

  // Recorded before the carrier is asked, mirroring `placeCall`/`open_call`: a row that says
  // "ringing" and never answers is a fact worth keeping; a carrier leg nothing recorded is not.
  const { data: participantId, error } = await db.rpc('add_call_participant', {
    p_organization_id: input.organizationId,
    p_call_id: input.callId,
    p_party: input.party,
  });
  if (error) throw staffOrCallerError(error, 'add a participant to this call');

  try {
    const placed = await provider.addToRoom({ room, from, to, reportTo });
    await db
      .from('call_participants')
      .update({ external_id: placed.externalId })
      .eq('organization_id', input.organizationId)
      .eq('id', participantId as string);
  } catch (cause) {
    await db.rpc('remove_call_participant', {
      p_organization_id: input.organizationId,
      p_participant_id: participantId as string,
    });
    throw new DomainError(
      `Could not add that participant: ${cause instanceof Error ? cause.message : String(cause)}`,
      'conference.add_failed',
    );
  }

  return { participantId: participantId as string };
}

/**
 * End one leg. The conference survives for everybody still in it — the entire reason D38 chose a
 * room over a two-party line: leaving is one operation on one participant, not a second call.
 */
export async function removeCallParticipant(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string },
): Promise<void> {
  const { room } = await callContext(db, input);
  const [participant] = (await listCallParticipants(db, input)).filter((row) => row.id === input.participantId);

  if (participant?.externalId) {
    const actingAccount = await actingTelephonyAccount(db, input.organizationId);
    const provider = await telephonyProvider(actingAccount);
    if (provider) {
      await provider.updateParticipant({ room, externalId: participant.externalId, status: 'completed' }).catch((cause) => {
        throw new DomainError(
          `Could not remove that participant: ${cause instanceof Error ? cause.message : String(cause)}`,
          'conference.remove_failed',
        );
      });
    }
  }

  const { error } = await db.rpc('remove_call_participant', {
    p_organization_id: input.organizationId,
    p_participant_id: input.participantId,
  });
  if (error) throw staffOrCallerError(error, 'remove a participant from this call');
}

/** Hold or resume one leg — a customer keeps hearing hold music, an agent hears nothing change. */
export async function setParticipantHold(
  db: Db,
  input: { organizationId: string; callId: string; participantId: string; hold: boolean },
): Promise<void> {
  const { room } = await callContext(db, input);
  const [participant] = (await listCallParticipants(db, input)).filter((row) => row.id === input.participantId);
  if (!participant) throw new DomainError('That participant is not on this call.', 'conference.no_participant');

  if (participant.externalId) {
    const actingAccount = await actingTelephonyAccount(db, input.organizationId);
    const provider = await telephonyProvider(actingAccount);
    if (provider) {
      await provider.updateParticipant({ room, externalId: participant.externalId, hold: input.hold }).catch((cause) => {
        throw new DomainError(
          `Could not change hold: ${cause instanceof Error ? cause.message : String(cause)}`,
          'conference.hold_failed',
        );
      });
    }
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
  const { room } = await callContext(db, input);
  const [participant] = (await listCallParticipants(db, input)).filter((row) => row.id === input.participantId);
  if (!participant) throw new DomainError('That participant is not on this call.', 'conference.no_participant');

  if (participant.externalId) {
    const actingAccount = await actingTelephonyAccount(db, input.organizationId);
    const provider = await telephonyProvider(actingAccount);
    if (provider) {
      await provider.updateParticipant({ room, externalId: participant.externalId, muted: input.muted }).catch((cause) => {
        throw new DomainError(
          `Could not change mute: ${cause instanceof Error ? cause.message : String(cause)}`,
          'conference.mute_failed',
        );
      });
    }
  }

  const { error } = await db.rpc('set_participant_muted', {
    p_organization_id: input.organizationId,
    p_participant_id: input.participantId,
    p_muted: input.muted,
  });
  if (error) throw staffOrCallerError(error, 'change mute on this call');
}

/**
 * Warm transfer: ring the destination into the room and leave the transferring agent in it too,
 * so both agents and the customer overlap before anyone leaves. Expressed as one participant
 * operation (D38), never a second call.
 */
export async function warmTransfer(
  db: Db,
  input: { organizationId: string; callId: string; toNumber: string },
): Promise<{ participantId: string }> {
  return addCallParticipant(db, { ...input, party: 'transfer_target' });
}

/**
 * Cold transfer: ring the destination in, then remove the transferring agent — the customer and
 * the new party stay connected. Two participant operations in sequence, not a parallel call.
 */
export async function coldTransfer(
  db: Db,
  input: { organizationId: string; callId: string; toNumber: string; transferringParticipantId: string },
): Promise<{ participantId: string }> {
  const added = await addCallParticipant(db, {
    organizationId: input.organizationId,
    callId: input.callId,
    party: 'transfer_target',
    toNumber: input.toNumber,
  });
  await removeCallParticipant(db, {
    organizationId: input.organizationId,
    callId: input.callId,
    participantId: input.transferringParticipantId,
  });
  return added;
}
