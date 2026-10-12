'use server';

import { revalidatePath } from 'next/cache';
import { getDb, getIdentityVerifier } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { changePassword } from '@/lib/domain/identity/credentials';
import { requestEmailChange, requestEmailChangeProof, updatePersonalProfile } from '@/lib/domain/identity/profile';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { saveAppearance, resetAppearance } from '@/lib/domain/identity/appearance';
import type { PersonalAppearancePreferences } from '@gold/ui/design-system';

export async function updateAppearanceAction(input: unknown, reset = false): Promise<{ selection?: PersonalAppearancePreferences; error?: string }> {
  try {
    const db = await getDb();
    const selection = reset ? await resetAppearance(db) : await saveAppearance(db, input);
    revalidatePath('/', 'layout');
    return { selection };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
import { requestOrigin } from '@/lib/route/origin';
import type { AccountFormState } from '@/features/account/account-form-state';

async function perform(work: () => Promise<void>, message: string): Promise<AccountFormState> {
  try {
    await work();
    revalidatePath('/settings/account', 'layout');
    return { error: null, message };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

export async function changePasswordAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  return perform(async () => {
    await changePassword(await getDb(), {
      currentPassword: String(formData.get('currentPassword') ?? ''),
      password: String(formData.get('password') ?? ''),
      passwordConfirmation: String(formData.get('passwordConfirmation') ?? ''),
      nonce: String(formData.get('nonce') ?? '') || undefined,
    }, getIdentityVerifier());
  }, 'Password changed.');
}

export async function requestPasswordCodeAction(): Promise<AccountFormState> {
  return perform(async () => {
    const db = await getDb();
    await requireActor(db);
    const { error } = await db.auth.reauthenticate();
    if (error) throw new DomainError('Unable to send a verification code. Try again shortly.', 'identity.reauthentication_failed');
  }, 'Verification code sent to your current email address.');
}

export async function updateProfileAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  return perform(async () => updatePersonalProfile(await getDb(), {
    given_name: String(formData.get('given_name') ?? ''),
    family_name: String(formData.get('family_name') ?? ''),
    preferred_name: String(formData.get('preferred_name') ?? ''),
    locale: String(formData.get('locale') ?? 'en'),
    timezone: String(formData.get('timezone') ?? 'UTC'),
    phone_e164: String(formData.get('phone_e164') ?? '') || null,
    address_line_1: String(formData.get('address_line_1') ?? '') || null,
    address_line_2: String(formData.get('address_line_2') ?? '') || null,
    city: String(formData.get('city') ?? '') || null,
    administrative_area: String(formData.get('administrative_area') ?? '') || null,
    postal_code: String(formData.get('postal_code') ?? '') || null,
    country_code: String(formData.get('country_code') ?? '') || null,
  }), 'Profile saved.');
}

export async function requestEmailCodeAction(): Promise<AccountFormState> {
  return perform(async () => requestEmailChangeProof(await getDb(), getIdentityVerifier()),
    'Verification code sent to your current email address.');
}

export async function changeEmailAction(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  return perform(async () => requestEmailChange(await getDb(), {
    email: String(formData.get('email') ?? ''),
    code: String(formData.get('code') ?? ''),
    redirectTo: `${await requestOrigin()}/auth/email-change`,
  }, getIdentityVerifier()), 'Check both your current and new email addresses to confirm the change.');
}
