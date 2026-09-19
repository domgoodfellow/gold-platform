'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  getProviderAccount,
  setDefaultProviderAccount,
  setProviderAccountStatus,
} from '@/lib/domain/providers/accounts';
import {
  configureTelephonyAccount,
  reconcileTelephonyAccount,
  verifyTelephonyAccount,
} from '@/lib/domain/providers/telephony-accounts';
import type { AccountCommandState, AccountFormState, ReconcileState } from './action-states';

/**
 * Server-only commands for GOLD's telephony account. The credential arrives in a form field, is
 * handed to the domain command and is never returned: no state below has a place to put it.
 */

const PATH = '/platform/providers/twilio';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'That could not be completed.';
}

export async function saveTelephonyAccountAction(_: AccountFormState, form: FormData): Promise<AccountFormState> {
  try {
    const db = await getDb();
    await configureTelephonyAccount(db, {
      accountId: String(form.get('accountId') ?? '') || undefined,
      label: String(form.get('label') ?? ''),
      externalAccountId: String(form.get('externalAccountId') ?? ''),
      credentialKind: String(form.get('credentialKind') ?? ''),
      credentialIdentifier: String(form.get('credentialIdentifier') ?? '').trim() || null,
      secret: String(form.get('secret') ?? '') || undefined,
    });
    revalidatePath(PATH, 'layout');
    return { error: null, saved: true };
  } catch (error) {
    return { error: message(error), saved: false };
  }
}

async function command(run: () => Promise<void>): Promise<AccountCommandState> {
  try {
    await run();
    revalidatePath(PATH, 'layout');
    return { error: null, done: true };
  } catch (error) {
    return { error: message(error), done: false };
  }
}

export async function verifyTelephonyAccountAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  const accountId = String(form.get('accountId') ?? '');
  const state = await command(async () => {
    await verifyTelephonyAccount(await getDb(), { accountId });
  });
  if (state.error) return state;

  // The outcome is recorded on the account either way; the operator also needs the provider's
  // words at the moment they press the button.
  const account = await getProviderAccount(await getDb(), accountId);
  if (account && account.verificationState !== 'verified') {
    return { error: account.verificationError ?? 'The provider did not accept this credential.', done: false };
  }
  return state;
}

export async function makeDefaultAccountAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  return command(async () => setDefaultProviderAccount(await getDb(), { accountId: String(form.get('accountId') ?? '') }));
}

export async function setAccountStatusAction(_: AccountCommandState, form: FormData): Promise<AccountCommandState> {
  const status = String(form.get('status') ?? '') === 'disabled' ? 'disabled' : 'active';
  return command(async () =>
    setProviderAccountStatus(await getDb(), { accountId: String(form.get('accountId') ?? ''), status }),
  );
}

export async function reconcileTelephonyAction(_: ReconcileState, form: FormData): Promise<ReconcileState> {
  try {
    const db = await getDb();
    const result = await reconcileTelephonyAccount(db, { accountId: String(form.get('accountId') ?? '') });
    const counts: Record<string, number> = {};
    for (const finding of result.findings) counts[finding.health] = (counts[finding.health] ?? 0) + 1;
    revalidatePath(PATH, 'layout');
    return {
      error: null,
      checkedAt: result.checkedAt,
      counts,
      findings: result.findings.filter((f) => f.health === 'remote_missing' || f.health === 'remote_changed'),
      unmanaged: result.unmanaged,
    };
  } catch (error) {
    return { error: message(error), checkedAt: null, counts: {}, findings: [], unmanaged: [] };
  }
}
