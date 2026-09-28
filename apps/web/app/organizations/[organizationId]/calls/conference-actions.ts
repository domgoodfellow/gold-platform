'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { browserTelephoneToken, placeCall } from '@/lib/domain/reception/calls';
import {
  addCallParticipant,
  coldTransfer,
  listCallParticipants,
  removeCallParticipant,
  setParticipantHold,
  setParticipantMuted,
  warmTransfer,
  type Participant,
} from '@/lib/domain/reception/conference';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The browser dialer's own server boundary. Every one of these is a direct call rather than a
 * form (`useActionState`'s `FormState` shape), because a live call's controls are button presses
 * that need a structured answer back on the same tick, not a page revalidation cycle — the one
 * place in this feature where that pattern earns its keep instead of a plain server action.
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
 * Ring a customer and hand back the room the browser Device still has to join. The structured
 * result exists because a client component needs `room` to connect the agent's own leg on the
 * same tick — the older `placeCallAction` (`calls/actions.ts`) returns only a `FormState` and
 * stays for the "Write it down" form, which has nothing to connect.
 */
export async function dialCustomerAction(
  organizationId: string,
  input: { customerId: string; toNumber: string },
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
    const token = await browserTelephoneToken(db);
    return { token };
  });
}

export async function listCallParticipantsAction(
  organizationId: string,
  callId: string,
): Promise<ActionResult<Participant[]>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return listCallParticipants(db, { organizationId, callId });
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

export async function muteParticipantAction(
  organizationId: string,
  input: { callId: string; participantId: string; muted: boolean },
): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await setParticipantMuted(db, { organizationId, ...input });
    return null;
  });
}

export async function addParticipantAction(
  organizationId: string,
  input: { callId: string; party: 'agent' | 'supervisor' | 'transfer_target'; toNumber: string },
): Promise<ActionResult<{ participantId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return addCallParticipant(db, { organizationId, ...input });
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

export async function coldTransferAction(
  organizationId: string,
  input: { callId: string; toNumber: string; transferringParticipantId: string },
): Promise<ActionResult<{ participantId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return coldTransfer(db, { organizationId, ...input });
  });
}
