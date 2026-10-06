import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

export async function updatePersonalProfile(db: Db, input: { displayName: string }): Promise<void> {
  await requireActor(db);
  const displayName = input.displayName.trim();
  if (displayName.length > 100) throw new DomainError('Use at most 100 characters for your name.', 'identity.name_invalid');
  // Cosmetic metadata only. Never update memberships or use this value for authorization.
  const { error } = await db.auth.updateUser({ data: { display_name: displayName } });
  if (error) throw new DomainError(error.message, 'identity.profile_update_failed');
}

/** A fresh email code works for both password and provider-only identities. */
export async function requestEmailChangeProof(db: Db, verifier: Db): Promise<void> {
  await requireActor(db);
  const { data } = await db.auth.getUser();
  if (!data.user?.email) throw new DomainError('Sign in to continue.', 'auth.required');
  const { error } = await verifier.auth.signInWithOtp({
    email: data.user.email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new DomainError('Unable to send a verification code. Try again shortly.', 'identity.email_proof_failed');
}

export async function requestEmailChange(db: Db, input: { email: string; code: string; redirectTo: string }, verifier: Db): Promise<void> {
  const actor = await requireActor(db);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('Enter an email address.', 'identity.email_invalid');
  if (!/^\d{6,10}$/.test(input.code.trim())) throw new DomainError('Enter the verification code sent to your current address.', 'identity.email_proof_required');
  const { data } = await db.auth.getUser();
  if (!data.user?.email) throw new DomainError('Sign in to continue.', 'auth.required');
  if (email === data.user.email.toLowerCase()) throw new DomainError('Enter a different email address.', 'identity.email_unchanged');
  const proof = await verifier.auth.verifyOtp({ email: data.user.email, token: input.code.trim(), type: 'email' });
  try {
    if (proof.error || !proof.data.session || proof.data.user?.id !== actor.id) throw new DomainError('That code is invalid or expired. Request another.', 'identity.email_proof_rejected');
    const { error } = await db.auth.updateUser({ email }, { emailRedirectTo: input.redirectTo });
    if (error) throw new DomainError(error.message, 'identity.email_change_failed');
  } finally {
    if (proof.data.session) await verifier.auth.signOut({ scope: 'local' });
  }
}
