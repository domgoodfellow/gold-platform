'use server';

import { storeVerificationEmail } from '@/lib/route/verification-email';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signInWithPassword } from '@/lib/domain/identity/credentials';
import { resolvePostAuthDestination } from '@/lib/route/landing';
import type { CredentialsState } from '../credentials-form';

export async function logInAction(
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
    if (error instanceof DomainError && error.code === 'identity.email_unverified') {
      await storeVerificationEmail(String(formData.get('email') ?? ''));
      redirect('/verify-email');
    }
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // Outside the try: redirect() signals by throwing, and catching it here would swallow
  // the navigation. One centralized rule (`resolvePostAuthDestination`) decides where every
  // successful sign-in lands, password and OAuth alike — see lib/route/landing.ts.
  redirect(await resolvePostAuthDestination(db));
}
