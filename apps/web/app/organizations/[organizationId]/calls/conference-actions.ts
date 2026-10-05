'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { browserTelephoneToken, placeCall } from '@/lib/domain/reception/calls';
import {
  addCallParticipant,
  cancelTransfer,
  coldTransfer,
  completeTransfer,
  endCall,
  leaveCall,
  listCallParticipants,
  removeCallParticipant,
  setParticipantHold,
  warmTransfer,
  type Participant,
} from '@/lib/domain/reception/conference';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The browser dialer's own server boundary. Every one of these is a direct call rather than a
 * form (`useActionState`'s `FormState` shape), because a live call's controls are button presses
 * that need a structured answer back on the same tick, not a page revalidation cycle — the one
 * place in this feature where that pattern earns its keep instead of a plain server action.
 *
 * Nothing here names a carrier, an account or an identifier of one: a control names a call and a
 * participant of this business, and the domain layer works out the rest.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(organizationId: string, run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await run();
    revalidatePath(`/organizations/${organizationId}/calls`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Ring a number and hand back the room the browser Device still has to join. The structured
 * result exists because a client component needs `room` to connect the agent's own leg on the
 * same tick — the "Write it down" form (`recordCallAction`, `calls/actions.ts`) has nothing to
 * connect and returns only a `FormState`. The number to ring from is never chosen here: at most the person names one of their own, and the domain layer decides.
 */
export async function dialAction(
  organizationId: string,
  input: { customerId?: string | null; toNumber: string; phoneNumberId?: string | null },
): Promise<ActionResult<{ callId: string; room: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return placeCall(db, { organizationId, ...input });
  });
}

/** A short-lived credential for this person's own browser Device — minted fresh on every call, never cached across requests. */
export async function mintBrowserTokenAction(organizationId: string): Promise<ActionResult<{ token: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    const token = await browserTelephoneToken(db, { organizationId });
    return { token };
  });
}

export type Roster = { participants: Participant[]; ownMembershipId: string | null };

export async function listCallParticipantsAction(
  organizationId: string,
  callId: string,
): Promise<ActionResult<Roster>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    const [participants, ownMembershipId] = await Promise.all([
      listCallParticipants(db, { organizationId, callId }),
      currentMembershipId(db, { organizationId }),
    ]);
    return { participants, ownMembershipId };
  });
}

export async function holdParticipantAction(
  organizationId: string,
  input: { callId: string; participantId: string; hold: boolean },
): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await setParticipantHold(db, { organizationId, ...input });
    return null;
  });
}

export async function addParticipantAction(
  organizationId: string,
  input: { callId: string; toNumber: string },
): Promise<ActionResult<{ participantId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return addCallParticipant(db, { organizationId, ...input, party: 'transfer_target' });
  });
}

export async function removeParticipantAction(
  organizationId: string,
  input: { callId: string; participantId: string },
): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await removeCallParticipant(db, { organizationId, ...input });
    return null;
  });
}

export async function warmTransferAction(
  organizationId: string,
  input: { callId: string; toNumber: string },
): Promise<ActionResult<{ participantId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return warmTransfer(db, { organizationId, ...input });
  });
}

export async function completeTransferAction(organizationId: string, input: { callId: string }): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await completeTransfer(db, { organizationId, ...input });
    return null;
  });
}

export async function cancelTransferAction(organizationId: string, input: { callId: string }): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await cancelTransfer(db, { organizationId, ...input });
    return null;
  });
}

export async function coldTransferAction(
  organizationId: string,
  input: { callId: string; toNumber: string },
): Promise<ActionResult<{ participantId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return coldTransfer(db, { organizationId, ...input });
  });
}

/** Stop this person's telephone closing the room when it hangs up, because somebody is staying on. */
export async function leaveCallAction(organizationId: string, input: { callId: string }): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await leaveCall(db, { organizationId, ...input });
    return null;
  });
}

/** Hang up every line of one call. */
export async function endCallAction(organizationId: string, input: { callId: string }): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await endCall(db, { organizationId, ...input });
    return null;
  });
}
