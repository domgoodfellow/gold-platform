import type { Db } from '@/lib/db/types';
import { requireAccessToken } from '@/lib/api/client';
import { DomainError } from '@/lib/domain/errors';
import {
  telephonyAccountOperations,
  telephonyProviderKey,
  telephonySubaccountName,
  validateTelephonyAccountIdentity,
} from '@/lib/adapters/telephony';
import {
  getProviderAccount,
  listProviderOrganizationStandings,
  recordBindingReconciliation,
  recordProviderAccount,
  storeProviderAccountCredential,
  type ProviderAccount,
} from './accounts';
import { compareWithRemote, type Reconciliation } from './reconciliation';

/**
 * Operating GOLD's telephony parent account: configuring it, proving it works, and comparing it
 * with what the carrier actually holds.
 *
 * **Verification is the carrier's answer, recorded by `apps/api`.** This file asks and shows the
 * outcome; it cannot mark an account verified, because the only door that does is granted to the
 * machine role that made the request (`record_provider_account_verification`).
 */

export async function configureTelephonyAccount(
  db: Db,
  input: {
    accountId?: string;
    label: string;
    externalAccountId: string;
    credentialKind: string;
    credentialIdentifier: string | null;
    /** Omitted on an edit that keeps the stored credential. */
    secret?: string;
  },
): Promise<string> {
  const problem = validateTelephonyAccountIdentity({
    accountId: input.externalAccountId.trim(),
    credentialKind: input.credentialKind,
    credentialIdentifier: input.credentialIdentifier?.trim() || null,
  });
  if (problem) throw new DomainError(problem, 'providers.account_invalid');

  if (!input.accountId && !input.secret?.trim()) {
    throw new DomainError('A new account needs its credential.', 'providers.credential_invalid');
  }

  const id = await recordProviderAccount(db, {
    providerKey: telephonyProviderKey(),
    label: input.label,
    externalAccountId: input.externalAccountId.trim(),
    credentialKind: input.credentialKind,
    credentialIdentifier: input.credentialIdentifier?.trim() || null,
    accountId: input.accountId,
  });

  if (input.secret?.trim()) await storeProviderAccountCredential(db, { accountId: id, secret: input.secret });
  return id;
}

/** Asks the carrier whether the stored credential works. The outcome is on the account row. */
export async function verifyTelephonyAccount(db: Db, input: { accountId: string }): Promise<ProviderAccount> {
  const account = await getProviderAccount(db, input.accountId);
  if (!account) throw new DomainError('No such provider account.', 'providers.account_missing');
  if (!account.credentialSetAt) throw new DomainError('Set a credential before verifying.', 'providers.credential_missing');

  const operations = await telephonyAccountOperations({ token: await requireAccessToken(db), accountId: account.id });
  await operations.verify();

  const after = await getProviderAccount(db, input.accountId);
  if (!after) throw new DomainError('No such provider account.', 'providers.account_missing');
  return after;
}

export type ReconciliationResult = Reconciliation & { checkedAt: string };

/**
 * Compares every binding under this account with the carrier's own list of subaccounts.
 *
 * Records what each binding's comparison found and changes nothing else — no status moves, no
 * resource is disabled, and nothing at the carrier is created, closed or adopted.
 */
export async function reconcileTelephonyAccount(db: Db, input: { accountId: string }): Promise<ReconciliationResult> {
  const account = await getProviderAccount(db, input.accountId);
  if (!account) throw new DomainError('No such provider account.', 'providers.account_missing');
  if (account.verificationState !== 'verified') {
    throw new DomainError('Verify this account before reconciling it.', 'providers.account_unverified');
  }

  const providerKey = telephonyProviderKey();
  const operations = await telephonyAccountOperations({ token: await requireAccessToken(db), accountId: account.id });
  const remote = await operations.listSubaccounts();
  const standings = await listProviderOrganizationStandings(db, { providerKey });

  const result = compareWithRemote({
    accountId: account.id,
    standings,
    remote,
    expectedName: telephonySubaccountName,
  });

  for (const finding of result.findings) {
    if (finding.health === 'in_sync' || finding.health === 'remote_missing' || finding.health === 'remote_changed') {
      await recordBindingReconciliation(db, {
        organizationId: finding.organizationId,
        providerKey,
        state: finding.health,
        detail: finding.detail,
      });
    }
  }

  return { ...result, checkedAt: new Date().toISOString() };
}
