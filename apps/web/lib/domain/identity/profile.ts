import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type AccountProfile = {
  given_name: string;
  family_name: string;
  preferred_name: string;
  avatar: string | null;
  locale: string;
  timezone: string;
};

export async function getPersonalProfile(db: Db): Promise<AccountProfile> {
  const actor = await requireActor(db);
  const { data, error } = await db.from('account_profiles')
    .select('given_name, family_name, preferred_name, avatar, locale, timezone')
    .eq('user_id', actor.id).single();
  if (error) throw new DomainError('Unable to load your profile. Try again.', 'identity.profile_load_failed');
  return data;
}

export function profileName(profile: AccountProfile): string {
  return profile.preferred_name || [profile.given_name, profile.family_name].filter(Boolean).join(' ');
}

export async function updatePersonalProfile(db: Db, input: AccountProfile): Promise<void> {
  const actor = await requireActor(db);
  const profile = { ...input, given_name: input.given_name.trim(), family_name: input.family_name.trim(), preferred_name: input.preferred_name.trim() };
  if ([profile.given_name, profile.family_name, profile.preferred_name].some((name) => name.length > 100)) {
    throw new DomainError('Use at most 100 characters for each name.', 'identity.name_invalid');
  }
  profile.avatar = input.avatar?.trim() || null;
  if (profile.avatar) {
    try {
      const url = new URL(profile.avatar);
      if (url.protocol !== 'https:' || url.username || url.password || profile.avatar.length > 2048) throw new Error();
    } catch { throw new DomainError('Use an HTTPS address for your avatar.', 'identity.avatar_invalid'); }
  }
  try {
    profile.locale = Intl.getCanonicalLocales(input.locale.trim())[0];
    if (!profile.locale || profile.locale.length > 64) throw new Error();
    profile.timezone = input.timezone.trim();
    new Intl.DateTimeFormat(profile.locale, { timeZone: profile.timezone });
    if (!profile.timezone || profile.timezone.length > 100) throw new Error();
  } catch { throw new DomainError('Choose a valid language and timezone.', 'identity.preferences_invalid'); }
  const { error } = await db.from('account_profiles').update({ ...profile, updated_at: new Date().toISOString() }).eq('user_id', actor.id).select('user_id').single();
  if (error) throw new DomainError('Unable to save your profile. Try again.', 'identity.profile_update_failed');
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
    if (error) throw new DomainError('Unable to request the email change. Try again shortly.', 'identity.email_change_failed');
  } finally {
    if (proof.data.session) await verifier.auth.signOut({ scope: 'local' });
  }
}
