'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { verifySignupEmail, requestSignupVerification } from '@/lib/domain/identity/verification';
import { readVerificationEmail, clearVerificationEmail } from '@/lib/route/verification-email';
import { resolvePostAuthDestination } from '@/lib/route/landing';

export type VerificationState = { error: string | null; message?: string };
export async function verifyEmailAction(_state: VerificationState, form: FormData): Promise<VerificationState> {
  const email = await readVerificationEmail();
  if (!email) return { error: 'Start signup or log in again to request verification.' };
  const db = await getDb();
  try { await verifySignupEmail(db, { email, code: String(form.get('code') ?? '') }); }
  catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
  await clearVerificationEmail();
  redirect(await resolvePostAuthDestination(db));
}
export async function resendEmailAction(): Promise<VerificationState> {
  const email = await readVerificationEmail();
  if (!email) return { error: 'Start signup or log in again to request verification.' };
  try { await requestSignupVerification(await getDb(), { email }); }
  catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
  return { error: null, message: 'If verification is still needed, a new code is on its way. Check your inbox and spam folder.' };
}
