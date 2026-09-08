'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { setNewPassword } from '@/lib/domain/identity/credentials';
import type { CredentialsState } from '../credentials-form';

export async function resetPasswordAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  try {
    await setNewPassword(db, {
      password: String(formData.get('password') ?? ''),
      passwordConfirmation: String(formData.get('passwordConfirmation') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // Straight in, because the recovery session is a real one and asking somebody to log in again
  // with the password they typed ten seconds ago is a step that proves nothing.
  //
  // Outside the try: redirect() signals by throwing, and catching it here would swallow the
  // navigation.
  redirect('/organizations');
}
