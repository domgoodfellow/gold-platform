'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  NUMBER_PURPOSES,
  assignPhoneNumber,
  configurePhoneNumber,
  releasePhoneNumberAssignment,
  setOutboundPreference,
  type NumberPurpose,
} from '@/lib/domain/reception/numbers';
import { requireOrganization } from '@/lib/route/organization';

/**
 * How a business uses its numbers. Every write is a domain operation that the database re-checks:
 * none of these touches where a number came from, which provider resource stands behind it, or
 * whether it exists — that is provisioning, and it is not reachable from here.
 */

export type NumberFormState = { error: string | null };

async function attempt(organizationId: string, phoneNumberId: string, run: () => Promise<unknown>): Promise<NumberFormState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/comms/numbers`);
  revalidatePath(`/organizations/${organizationId}/comms/numbers/${phoneNumberId}`);
  return { error: null };
}

export async function configureNumberAction(_previous: NumberFormState, formData: FormData): Promise<NumberFormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '');
  await requireOrganization(organizationId);
  const purpose = String(formData.get('purpose') ?? '');

  return attempt(organizationId, phoneNumberId, async () => {
    const db = await getDb();
    await configurePhoneNumber(db, {
      organizationId,
      phoneNumberId,
      label: String(formData.get('label') ?? ''),
      purpose: (NUMBER_PURPOSES as readonly string[]).includes(purpose) ? (purpose as NumberPurpose) : 'general',
      // An unticked box is absent from the payload rather than false.
      voiceInbound: formData.get('voiceInbound') !== null,
      voiceOutbound: formData.get('voiceOutbound') !== null,
      smsInbound: formData.get('smsInbound') !== null,
      smsOutbound: formData.get('smsOutbound') !== null,
    });
  });
}

export async function assignNumberAction(_previous: NumberFormState, formData: FormData): Promise<NumberFormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, phoneNumberId, async () => {
    const db = await getDb();
    await assignPhoneNumber(db, {
      organizationId,
      phoneNumberId,
      memberId: String(formData.get('memberId') ?? ''),
      isDefault: formData.get('isDefault') !== null,
    });
  });
}

export async function releaseAssignmentAction(_previous: NumberFormState, formData: FormData): Promise<NumberFormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, phoneNumberId, async () => {
    const db = await getDb();
    await releasePhoneNumberAssignment(db, { organizationId, assignmentId: String(formData.get('assignmentId') ?? '') });
  });
}

export async function useNumberAsMineAction(_previous: NumberFormState, formData: FormData): Promise<NumberFormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '');
  await requireOrganization(organizationId);

  return attempt(organizationId, phoneNumberId, async () => {
    const db = await getDb();
    await setOutboundPreference(db, { organizationId, phoneNumberId });
  });
}
