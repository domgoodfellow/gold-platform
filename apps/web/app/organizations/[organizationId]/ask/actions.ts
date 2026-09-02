'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { askQuestion } from '@/lib/domain/assistant/questions';
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

  revalidatePath(`/organizations/${organizationId}/ask`);
  return { error: null };
}
