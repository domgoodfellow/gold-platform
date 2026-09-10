'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requestPasswordReset } from '@/lib/domain/identity/credentials';
import { requestOrigin } from '@/lib/route/origin';
import type { CredentialsState } from '../credentials-form';

/**
 * Ask for a recovery link.
 *
 * **Success is the only outcome a stranger can observe**, and the domain function says why: a
 * form that answered differently for a registered address than an unregistered one would be a
 * way to enumerate who has an account. The only error this can return is a malformed address,
 * which the person typing it already knows.
 */
export async function forgotPasswordAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  try {
    await requestPasswordReset(db, {
      email: String(formData.get('email') ?? ''),
      // **A fixed destination built from this request's own host, never from the form.** The
      // route it names is the only one that exchanges a recovery code, and it redirects to one
      // literal — so there is no parameter anywhere in this flow that decides where somebody
      // lands, which is `proxy.ts`'s reasoning about `?next=` applied to the same problem.
      redirectTo: `${await requestOrigin()}/auth/recover`,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  return { error: null, done: true };
}
