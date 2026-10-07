'use server';

import { storeVerificationEmail } from '@/lib/route/verification-email';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { registerWithPassword } from '@/lib/domain/identity/credentials';
import { requestOrigin } from '@/lib/route/origin';
import { resolvePostAuthDestination } from '@/lib/route/landing';
import type { CredentialsState } from '../credentials-form';

export async function signUpAction(
  _previous: CredentialsState,
  formData: FormData,
): Promise<CredentialsState> {
  const db = await getDb();

  let verificationRequired: boolean;
  try {
    ({ verificationRequired } = await registerWithPassword(db, {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      passwordConfirmation: String(formData.get('passwordConfirmation') ?? ''),
      emailRedirectTo: `${await requestOrigin()}/auth/callback`,
      givenName: String(formData.get('givenName') ?? ''),
      familyName: String(formData.get('familyName') ?? ''),
      preferredName: String(formData.get('preferredName') ?? ''),
    }));
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  if (verificationRequired) {
    await storeVerificationEmail(String(formData.get('email') ?? ''));
    redirect('/verify-email');
  }
  redirect(await resolvePostAuthDestination(db));
}
