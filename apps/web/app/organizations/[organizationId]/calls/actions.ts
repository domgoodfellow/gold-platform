'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createCustomerStage, updateCustomerStage } from '@/lib/domain/customers/stages';
import { DomainError } from '@/lib/domain/errors';
import { createCallOutcome } from '@/lib/domain/reception/outcomes';
import { placeCall, recordCall, recordCallOutcome } from '@/lib/domain/reception/calls';

/**
 * The reception module's writes.
 *
 * Every one of them is a thin translation of a form into a domain call. Nothing here decides
 * anything: whether the caller may is decided by the policy on the table, and what the words
 * mean is decided by the business that typed them.
 */

export type FormState = { error: string | null };

/** One shape for every action here, because every one of them fails the same way. */
async function attempt(
  organizationId: string,
  path: string,
  run: () => Promise<unknown>,
): Promise<FormState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}${path}`);
  return { error: null };
}

export async function createStageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return attempt(organizationId, '/calls', () =>
    createCustomerStage(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

export async function updateStageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return attempt(organizationId, '/calls', () =>
    updateCustomerStage(db, {
      id: String(formData.get('id') ?? ''),
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

export async function createOutcomeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  return attempt(organizationId, '/calls', () =>
    createCallOutcome(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      // An unticked checkbox is absent from the payload rather than false.
      reached: formData.get('reached') !== null,
      position: Number(formData.get('position') ?? 0),
    }),
  );
}

/**
 * Ring somebody.
 *
 * The number is submitted rather than read from the customer here, because a business calls a
 * mobile today and a switchboard tomorrow and both belong to the same customer. Which numbers a
 * customer has is the customer's record; which one is being dialled is this call's fact.
 */
export async function placeCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const customerId = String(formData.get('customerId') ?? '');

  return attempt(organizationId, `/customers/${customerId}`, () =>
    placeCall(db, {
      organizationId,
      customerId,
      toNumber: String(formData.get('toNumber') ?? ''),
    }),
  );
}

/** Write down a call that happened on somebody's mobile. */
export async function recordCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const customerId = String(formData.get('customerId') ?? '');
  const direction = String(formData.get('direction') ?? 'outbound');

  return attempt(organizationId, `/customers/${customerId}`, () =>
    recordCall(db, {
      organizationId,
      customerId,
      // Narrowed by the domain layer's own type and refused by the check constraint behind it;
      // this cast asserts nothing the database does not already enforce.
      direction: direction === 'inbound' ? 'inbound' : 'outbound',
      fromNumber: String(formData.get('fromNumber') ?? ''),
      toNumber: String(formData.get('toNumber') ?? ''),
    }),
  );
}

export async function wrapUpCallAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const outcomeId = String(formData.get('outcomeId') ?? '');
  const duration = String(formData.get('durationSeconds') ?? '');

  return attempt(organizationId, '/calls', () =>
    recordCallOutcome(db, {
      organizationId,
      callId: String(formData.get('callId') ?? ''),
      // An empty select means nobody has said yet, which is a real answer and not a validation
      // failure.
      outcomeId: outcomeId === '' ? null : outcomeId,
      note: String(formData.get('note') ?? ''),
      durationSeconds: duration === '' ? null : Number(duration),
    }),
  );
}
