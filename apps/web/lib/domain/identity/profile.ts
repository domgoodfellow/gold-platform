import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

export const PROFILE_CONTACT_LIMITS = {
  phone_e164: 16, address_line_1: 200, address_line_2: 200,
  city: 100, administrative_area: 100, postal_code: 32, country_code: 2,
} as const;

// ISO 3166-1 alpha-2; presentation can evolve without changing stored identifiers.
const COUNTRY_CODES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));

export type ProfileContact = { [K in keyof typeof PROFILE_CONTACT_LIMITS]: string | null };

export type AccountProfile = ProfileContact & {
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
    .select('given_name, family_name, preferred_name, avatar, locale, timezone, phone_e164, address_line_1, address_line_2, city, administrative_area, postal_code, country_code')
    .eq('user_id', actor.id).single();
  if (error) throw new DomainError('Unable to load your profile. Try again.', 'identity.profile_load_failed');
  return data;
}

export function profileName(profile: AccountProfile): string {
  return profile.preferred_name || [profile.given_name, profile.family_name].filter(Boolean).join(' ');
}

export async function updatePersonalProfile(db: Db, input: Omit<AccountProfile, keyof ProfileContact | 'avatar'> & Partial<ProfileContact> & { avatar?: string | null }): Promise<void> {
  const actor = await requireActor(db);
  const profile = {
    given_name: input.given_name.trim(),
    family_name: input.family_name.trim(),
    preferred_name: input.preferred_name.trim(),
    locale: input.locale,
    timezone: input.timezone,
    ...Object.fromEntries(Object.entries(PROFILE_CONTACT_LIMITS).filter(([key]) => key in input).map(([key, limit]) => {
      const value = input[key as keyof ProfileContact]?.trim() || null;
      if (value && value.length > limit) throw new DomainError(`Use at most ${limit} characters for ${key.replaceAll('_', ' ')}.`, 'identity.contact_invalid');
      return [key, value];
    })) as Partial<ProfileContact>,
  };
  if (profile.country_code && !/^[a-z]{2}$/i.test(profile.country_code)) {
    throw new DomainError('Enter an ISO two-letter country code, such as CA or GB.', 'identity.country_invalid');
  }
  if ('country_code' in profile) profile.country_code = profile.country_code?.toUpperCase() || null;
  if (profile.country_code && !COUNTRY_CODES.has(profile.country_code)) {
    throw new DomainError('Enter an ISO two-letter country code, such as CA or GB.', 'identity.country_invalid');
  }
  // No international parser is installed. Require explicit E.164, never infer a country.
  if (profile.phone_e164 && !/^\+[1-9][0-9]{1,14}$/.test(profile.phone_e164)) {
    throw new DomainError('Enter a phone number with + and country code, without spaces, such as +14165550142.', 'identity.phone_invalid');
  }
  if ([profile.given_name, profile.family_name, profile.preferred_name].some((name) => name.length > 100)) {
    throw new DomainError('Use at most 100 characters for each name.', 'identity.name_invalid');
  }
  const avatar = input.avatar?.trim() || null;
  if (avatar) {
    try {
      const url = new URL(avatar);
      if (url.protocol !== 'https:' || url.username || url.password || avatar.length > 2048) throw new Error();
    } catch { throw new DomainError('Use an HTTPS address for your avatar.', 'identity.avatar_invalid'); }
  }
  try {
    profile.locale = Intl.getCanonicalLocales(input.locale.trim())[0];
    if (!profile.locale || profile.locale.length > 64) throw new Error();
    profile.timezone = input.timezone.trim();
    new Intl.DateTimeFormat(profile.locale, { timeZone: profile.timezone });
    if (!profile.timezone || profile.timezone.length > 100) throw new Error();
  } catch { throw new DomainError('Choose a valid language and timezone.', 'identity.preferences_invalid'); }
  const { error } = await db.from('account_profiles').update({ ...profile, ...(input.avatar !== undefined ? { avatar } : {}), updated_at: new Date().toISOString() }).eq('user_id', actor.id).select('user_id').single();
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
