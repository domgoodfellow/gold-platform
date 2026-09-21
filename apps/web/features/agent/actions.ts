'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { askQuestion, decideOnAction } from '@/lib/domain/assistant/questions';
import { DomainError } from '@/lib/domain/errors';

export type AskActionState = { error: string | null };

/**
 * One write, and it is a question.
 *
 * Nothing here decides anything, which is the ordinary rule and worth restating on this screen
 * in particular: the tempting thing to add is a check on what the answer said before showing it,
 * and that would be this route forming an opinion about a business's own data.
 */
export async function askAction(
  _previous: AskActionState,
  formData: FormData,
): Promise<AskActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await askQuestion(db, {
      organizationId,
      question: String(formData.get('question') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The Agent rail is mounted by the organization layout, so its history is refreshed there.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  return { error: null };
}

/**
 * Carry out what a question suggested, or say no to it.
 *
 * Two buttons and one action, because the decision is one thing with two answers and a declined
 * suggestion is as much a decision as a carried-out one. Nothing here decides which: the form
 * says, the domain layer does it, and what the database refuses comes back as words.
 */
export async function decideAction(
  _previous: AskActionState,
  formData: FormData,
): Promise<AskActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await decideOnAction(db, {
      runId: String(formData.get('runId') ?? ''),
      carryOut: formData.get('decision') === 'carry-out',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The Agent rail is mounted by the organization layout, so its history is refreshed there.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  return { error: null };
}
