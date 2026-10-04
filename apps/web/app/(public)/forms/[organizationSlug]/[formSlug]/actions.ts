'use server';

import { getDb } from '@/lib/db/server';
import { submitPublicForm } from '@/lib/domain/forms/public-forms';

export type PublicFormActionState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string>; stale: boolean };

/**
 * A visitor's submission. The business and form arrive as the public slugs in the address, and the
 * answers are re-checked against the published definition in the domain layer — a browser's
 * validation is a convenience, never the check. `website` is a honeypot: a person never sees it, so
 * anything in it is a script, and it is answered with the same "sent" a person gets.
 */
export async function submitFormAction(input: {
  organizationSlug: string;
  formSlug: string;
  revisionId: string;
  answers: Record<string, unknown>;
  website?: string;
}): Promise<PublicFormActionState> {
  if (input.website) return { status: 'sent' };
  const result = await submitPublicForm(await getDb(), {
    organizationSlug: input.organizationSlug,
    formSlug: input.formSlug,
    revisionId: input.revisionId,
    answers: input.answers,
  });
  if (result.ok) return { status: 'sent' };
  return { status: 'error', message: result.message, fieldErrors: result.fieldErrors, stale: result.stale };
}
