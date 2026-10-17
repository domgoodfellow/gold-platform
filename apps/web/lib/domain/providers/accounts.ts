import type { Db } from '@/lib/db/types';
import { requireAccessToken, callDomainCommand } from '@/lib/api/client';
import { DomainError } from '@/lib/domain/errors';

/**
 * GOLD's own accounts with an upstream provider — the parent every organization's scope sits
 * beneath.
 *
 * **Four nouns, four owners; this file is the first.** A *provider account* is a GOLD-owned
 * upstream account. An *organization provider binding* (`bindings.ts`) is the scope GOLD
 * provisioned for one tenant beneath it, and a *resource* is one safe thing inside that scope. A
 * tenant's own authorization to an outside system is an `integration_connection` and is not here.
 *
 * **A credential goes in and never comes out.** `storeProviderAccountCredential` returns nothing
 * and no reader exists in this runtime: the row exposes `credentialSetAt`, which is the whole of
 * what a person may know about it. Using the credential happens in `apps/api`.
 *
 * Every write is a narrow function, exactly as for bindings — staff hold no table grant.
 */

export type ProviderAccount = {
  id: string;
  providerKey: string;
  label: string;
  externalAccountId: string | null;
  credentialKind: string;
  credentialIdentifier: string | null;
  credentialSetAt: string | null;
  status: 'active' | 'disabled';
  verificationState: 'unverified' | 'verified' | 'failed';
  lastVerifiedAt: string | null;
  verificationError: string | null;
  isDefault: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const ACCOUNT_COLUMNS =
  'id, provider_key, label, external_account_id, credential_kind, credential_identifier, credential_set_at, status, verification_state, last_verified_at, verification_error, is_default, metadata, created_at, updated_at';

type AccountRow = {
  id: string;
  provider_key: string;
  label: string;
  external_account_id: string | null;
  credential_kind: string;
  credential_identifier: string | null;
  credential_set_at: string | null;
  status: string;
  verification_state: string;
  last_verified_at: string | null;
  verification_error: string | null;
  is_default: boolean;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

function toAccount(row: AccountRow): ProviderAccount {
  return {
    id: row.id,
    providerKey: row.provider_key,
    label: row.label,
    externalAccountId: row.external_account_id,
    credentialKind: row.credential_kind,
    credentialIdentifier: row.credential_identifier,
    credentialSetAt: row.credential_set_at,
    status: row.status as ProviderAccount['status'],
    verificationState: row.verification_state as ProviderAccount['verificationState'],
    lastVerifiedAt: row.last_verified_at,
    verificationError: row.verification_error,
    isDefault: row.is_default,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Staff only: the table's one policy admits nobody else, so anyone else reads an empty list. */
export async function listProviderAccounts(db: Db, input: { providerKey?: string } = {}): Promise<ProviderAccount[]> {
  let query = db.from('platform_provider_accounts').select(ACCOUNT_COLUMNS);
  if (input.providerKey) query = query.eq('provider_key', input.providerKey);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new DomainError(error.message, 'providers.accounts_failed');
  return (data ?? []).map(toAccount);
}

export async function getProviderAccount(db: Db, id: string): Promise<ProviderAccount | null> {
  const { data, error } = await db.from('platform_provider_accounts').select(ACCOUNT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new DomainError(error.message, 'providers.account_failed');
  return data ? toAccount(data) : null;
}

export async function getDefaultProviderAccount(db: Db, providerKey: string): Promise<ProviderAccount | null> {
  const { data, error } = await db
    .from('platform_provider_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('provider_key', providerKey)
    .eq('is_default', true)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'providers.account_failed');
  return data ? toAccount(data) : null;
}

function staffWriteError(error: { code?: string; message: string }, action: string): DomainError {
  return new DomainError(
    error.code === '42501' ? `Only platform staff may ${action}.` : error.message,
    'providers.write_failed',
  );
}

/** Creates an account, or edits the identity of `accountId`. Never touches the credential. */
export async function recordProviderAccount(
  db: Db,
  input: {
    providerKey: string;
    label: string;
    externalAccountId: string;
    credentialKind: string;
    credentialIdentifier: string | null;
    accountId?: string;
  },
): Promise<string> {
  const label = input.label.trim();
  if (!label) throw new DomainError('An account needs a label.', 'providers.account_invalid');

  const { data, error } = await db.rpc('record_provider_account', {
    p_provider_key: input.providerKey,
    p_label: label,
    p_external_account_id: input.externalAccountId.trim(),
    p_credential_kind: input.credentialKind,
    p_credential_identifier: input.credentialIdentifier?.trim() ?? '', // the function reads an empty string as none
    p_account_id: input.accountId,
  });
  if (error) throw staffWriteError(error, 'change a provider account');
  return data as string;
}

/** Sets or replaces the credential. Returns nothing: there is no value to hand back. */
export async function storeProviderAccountCredential(db: Db, input: { accountId: string; secret: string }): Promise<void> {
  if (!input.secret.trim()) throw new DomainError('A credential is required.', 'providers.credential_invalid');
  const { error } = await db.rpc('store_provider_account_credential', {
    p_account_id: input.accountId,
    p_secret: input.secret,
  });
  if (error) throw staffWriteError(error, 'store a provider credential');
}

/** Disabling stops new provisioning under the account. It never touches a binding or upstream. */
export async function setProviderAccountStatus(
  db: Db,
  input: { accountId: string; status: ProviderAccount['status'] },
): Promise<void> {
  const { error } = await db.rpc('set_provider_account_status', { p_account_id: input.accountId, p_status: input.status });
  if (error) throw staffWriteError(error, 'change a provider account');
}

export async function setDefaultProviderAccount(db: Db, input: { accountId: string }): Promise<void> {
  const { error } = await db.rpc('set_default_provider_account', { p_account_id: input.accountId });
  if (error) throw staffWriteError(error, 'change a provider account');
}

/**
 * Asks the provider whether the stored credential works, for an account with no per-provider
 * operations of its own (openai, anthropic, google today) — the generic counterpart to
 * `telephony-accounts.ts`'s `verifyTelephonyAccount`, which needs its own file only because
 * Twilio's capability offers more than `verify`. Every account, whatever the provider, is reached
 * the same way: the caller's own token, forwarded to `apps/api`'s `/providers/operate`, which
 * proves staff and reads the credential from Vault. This file never sees it.
 */
export async function verifyProviderAccount(db: Db, input: { accountId: string }): Promise<ProviderAccount> {
  const account = await getProviderAccount(db, input.accountId);
  if (!account) throw new DomainError('No such provider account.', 'providers.account_missing');
  if (!account.credentialSetAt) throw new DomainError('Set a credential before verifying.', 'providers.credential_missing');

  await callDomainCommand('/providers/operate', {
    token: await requireAccessToken(db),
    body: { account_id: account.id, operation: 'verify', arguments: {} },
  });

  const after = await getProviderAccount(db, input.accountId);
  if (!after) throw new DomainError('No such provider account.', 'providers.account_missing');
  return after;
}

/** One organization's standing with one provider, or the absence of any — staff only. */
export type ProviderOrganizationStanding = {
  organizationId: string;
  organizationName: string;
  /** Null when the organization has no binding with this provider. */
  bindingId: string | null;
  bindingStatus: 'provisioning' | 'active' | 'failed' | 'suspended' | null;
  externalAccountId: string | null;
  /** The GOLD account the binding lives under. Null for a bootstrap binding or no binding. */
  providerAccountId: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  reconciliationState: 'in_sync' | 'remote_missing' | 'remote_changed' | null;
  reconciliationDetail: string | null;
  lastReconciledAt: string | null;
  resourceCount: number;
  boundAt: string | null;
};

export async function listProviderOrganizationStandings(
  db: Db,
  input: { providerKey: string; organizationId?: string },
): Promise<ProviderOrganizationStanding[]> {
  const { data, error } = await db.rpc('platform_provider_organization_overview', {
    p_provider_key: input.providerKey,
    p_organization_id: input.organizationId,
  });
  if (error) throw staffWriteError(error, 'read provider standings');

  return (data ?? []).map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    bindingId: row.binding_id,
    bindingStatus: row.binding_status as ProviderOrganizationStanding['bindingStatus'],
    externalAccountId: row.external_account_id,
    providerAccountId: row.provider_account_id,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    reconciliationState: row.reconciliation_state as ProviderOrganizationStanding['reconciliationState'],
    reconciliationDetail: row.reconciliation_detail,
    lastReconciledAt: row.last_reconciled_at,
    resourceCount: Number(row.resource_count ?? 0),
    boundAt: row.bound_at,
  }));
}

export async function recordBindingReconciliation(
  db: Db,
  input: {
    organizationId: string;
    providerKey: string;
    state: NonNullable<ProviderOrganizationStanding['reconciliationState']>;
    detail?: string | null;
  },
): Promise<void> {
  const { error } = await db.rpc('record_provider_binding_reconciliation', {
    p_organization_id: input.organizationId,
    p_provider_key: input.providerKey,
    p_state: input.state,
    p_detail: input.detail ?? undefined,
  });
  if (error) throw staffWriteError(error, 'record a reconciliation');
}
