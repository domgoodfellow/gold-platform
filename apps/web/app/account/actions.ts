'use server';

import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { changePassword } from '@/lib/domain/identity/credentials';
import type { CredentialsState } from '@/app/(auth)/credentials-form';

/**
 * Shaped as `CredentialsState` deliberately — `CredentialsForm` is the one form for every
 * credential screen precisely so a fifth one is not written to look almost like the other four.
 */
export async function changePasswordAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  try {
    await changePassword(db, {
      password: String(formData.get('password') ?? ''),
      passwordConfirmation: String(formData.get('passwordConfirmation') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  return { error: null, done: true };
}
