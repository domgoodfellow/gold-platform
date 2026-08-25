'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signInWithPassword } from '@/lib/domain/identity/credentials';
import type { CredentialsState } from '@/components/credentials-form';

export async function signInAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  try {
    await signInWithPassword(db, {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // Outside the try: redirect() signals by throwing, and catching it here would swallow
  // the navigation.
  redirect('/organizations');
}
