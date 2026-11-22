'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import {
  getProviderAccount,
  recordProviderAccount,
  setDefaultProviderAccount,
  setProviderAccountStatus,
  storeProviderAccountCredential,
  verifyProviderAccount,
} from '@/lib/domain/providers/accounts';
import type { AccountCommandState, AccountFormState } from './action-states';

/**
 * Server-only commands for a GOLD-owned, API-key-only provider account (openai, anthropic,
 * google) — the generic counterpart to `providers/twilio/actions.ts`. One route, so one file
 * serves whichever `providerKey` the dynamic segment currently is; the credential arrives in a
 * form field, is handed to the domain layer and is never returned.
 */

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'That could not be completed.';
}

export async function saveProviderAccountAction(_: AccountFormState, form: FormData): Promise<AccountFormState> {
  try {
    const db = await getDb();
    const providerKey = String(form.get('providerKey') ?? '');
    const accountId = String(form.get('accountId') ?? '') || undefined;
    const label = String(form.get('label') ?? '');
    const secret = String(form.get('secret') ?? '');

    if (!accountId && !secret.trim()) {
      throw new Error('A new account needs its API key.');
    }

    const id = await recordProviderAccount(db, {
      providerKey,
      label,
      externalAccountId: '',
      credentialKind: 'api_key',
      credentialIdentifier: null,
      accountId,
    });

    if (secret.trim()) await storeProviderAccountCredential(db, { accountId: id, secret });

    revalidatePlatform();
    return { error: null, saved: true };
  } catch (error) {
    return { error: message(error), saved: false };
  }
}

async function command(run: () => Promise<void>): Promise<AccountCommandState> {
  try {
    await run();
    revalidatePlatform();
    return { error: null, done: true };
  } catch (error) {
    return { error: message(error), done: false };
  }
}

export async function verifyProviderAccountAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  const accountId = String(form.get('accountId') ?? '');
  const db = await getDb();
  const state = await command(async () => {
    await verifyProviderAccount(db, { accountId });
  });
  if (state.error) return state;

  // The outcome is recorded on the account either way; the operator also needs the provider's
  // own words at the moment they press the button.
  const after = await getProviderAccount(db, accountId);
  if (after && after.verificationState !== 'verified') {
    return { error: after.verificationError ?? 'The vendor did not accept this credential.', done: false };
  }
  return state;
}

export async function makeProviderAccountDefaultAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  return command(async () => setDefaultProviderAccount(await getDb(), { accountId: String(form.get('accountId') ?? '') }));
}

export async function setProviderAccountStatusAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  const status = String(form.get('status') ?? '') === 'disabled' ? 'disabled' : 'active';
  return command(async () =>
    setProviderAccountStatus(await getDb(), { accountId: String(form.get('accountId') ?? ''), status }),
  );
}
