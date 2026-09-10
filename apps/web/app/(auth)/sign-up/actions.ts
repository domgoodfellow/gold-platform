'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { registerWithPassword } from '@/lib/domain/identity/credentials';
import { requestOrigin } from '@/lib/route/origin';
import type { CredentialsState } from '../credentials-form';

export async function signUpAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  try {
    await registerWithPassword(db, {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      passwordConfirmation: String(formData.get('passwordConfirmation') ?? ''),
      emailRedirectTo: `${await requestOrigin()}/auth/callback`,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect('/organizations');
}
