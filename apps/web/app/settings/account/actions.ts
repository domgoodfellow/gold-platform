'use server';

import { revalidatePath } from 'next/cache';
import { getDb, getIdentityVerifier } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { changePassword } from '@/lib/domain/identity/credentials';
import { requestEmailChange, requestEmailChangeProof, updatePersonalProfile } from '@/lib/domain/identity/profile';
import { requireActor } from '@/lib/domain/tenancy/actor';
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
    displayName: String(formData.get('displayName') ?? ''),
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
