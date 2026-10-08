'use server';

import { getDb } from '@/lib/db/server';
import { submitPublicFormByKey, type PublicFormSource } from '@/lib/domain/forms/public-forms';

export type PublicFormActionState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string>; stale: boolean };

const SOURCES: readonly PublicFormSource[] = ['hosted', 'website', 'embed'];

/**
 * A visitor's submission, from the hosted page, a website, a business's own hostname or an embed.
 * The form is named by its public key and the business is whatever owns it; the answers are
 * re-checked against the published definition in the domain layer, and again by the database — a
 * browser's validation is a convenience, never the check. `website` is a honeypot: a person never
 * sees it, so anything in it is a script, and it is answered with the same "sent" a person gets.
 */
export async function submitFormByKeyAction(input: {
  publicKey: string;
  revisionId: string;
  answers: Record<string, unknown>;
  source: string;
  website?: string;
  attribution?: { token?: string; utm: Record<string, string>; requestId: string };
}): Promise<PublicFormActionState> {
  if (input.website) return { status: 'sent' };
  const source = SOURCES.find((candidate) => candidate === input.source) ?? 'hosted';
  const result = await submitPublicFormByKey(await getDb(), {
    publicKey: input.publicKey,
    revisionId: input.revisionId,
    answers: input.answers,
    source,
    attribution: input.attribution,
  });
  if (result.ok) return { status: 'sent' };
  return { status: 'error', message: result.message, fieldErrors: result.fieldErrors, stale: result.stale };
}
