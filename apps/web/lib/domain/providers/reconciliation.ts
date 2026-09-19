import type { RemoteSubaccount } from '@/lib/adapters/telephony';
import type { ProviderOrganizationStanding } from './accounts';

/**
 * Comparing what GOLD believes it provisioned with what the provider says exists.
 *
 * **Pure on purpose.** It takes two lists and returns findings; it reads nothing, writes nothing
 * and calls no one, so every situation an operator will meet is a plain test. Acting on a finding
 * is never this file's job — a scope the provider has and GOLD does not is *reported*, never
 * adopted, and a scope GOLD expects and the provider lacks is *reported*, never recreated.
 *
 * **Only bindings under the account being reconciled are judged against its remote list.** A
 * bootstrap binding (no provider account, provisioned from the deployment's own credential)
 * cannot be judged against an account it was never recorded under, so it is counted as known —
 * its scope must not surface as somebody else's — and left out of the verdicts.
 */

export type TenantHealth =
  | 'not_provisioned'
  | 'provisioning'
  | 'failed'
  | 'suspended'
  | 'in_sync'
  | 'remote_missing'
  | 'remote_changed'
  | 'unchecked';

export type TenantFinding = {
  organizationId: string;
  health: TenantHealth;
  detail: string | null;
};

export type UnmanagedRemote = { sid: string; friendlyName: string | null; status: string | null };

export type Reconciliation = {
  findings: TenantFinding[];
  unmanaged: UnmanagedRemote[];
};

/** What an operator sees for a tenant before any remote comparison has been made. */
export function localHealth(row: ProviderOrganizationStanding): TenantHealth {
  if (!row.bindingId || !row.bindingStatus) return 'not_provisioned';
  if (row.bindingStatus === 'failed') return 'failed';
  if (row.bindingStatus === 'provisioning') return 'provisioning';
  if (row.bindingStatus === 'suspended') return 'suspended';
  return row.reconciliationState ?? 'unchecked';
}

export function compareWithRemote(input: {
  accountId: string;
  standings: ProviderOrganizationStanding[];
  remote: RemoteSubaccount[];
  /** The name GOLD gives a business's scope; a mismatch is the one drift worth reporting. */
  expectedName: (organizationId: string) => string;
}): Reconciliation {
  const remoteBySid = new Map(input.remote.map((row) => [row.sid, row]));
  const known = new Set(
    input.standings.map((row) => row.externalAccountId).filter((sid): sid is string => Boolean(sid)),
  );

  const findings: TenantFinding[] = input.standings.map((row) => {
    const base = localHealth(row);
    // Not provisioned, failed, provisioning and suspended are GOLD's own states and stay as they
    // are; only a binding GOLD believes is live is worth asking the provider about.
    if (row.bindingStatus !== 'active' || row.providerAccountId !== input.accountId) {
      const own: TenantHealth = row.bindingStatus === 'active' ? 'unchecked' : base;
      return { organizationId: row.organizationId, health: own, detail: row.lastError };
    }
    if (!row.externalAccountId) {
      return { organizationId: row.organizationId, health: 'remote_missing', detail: 'The binding is active but records no subaccount.' };
    }

    const remote = remoteBySid.get(row.externalAccountId);
    if (!remote) {
      return {
        organizationId: row.organizationId,
        health: 'remote_missing',
        detail: `${row.externalAccountId} is not among this account's subaccounts.`,
      };
    }
    if (remote.status !== 'active') {
      return { organizationId: row.organizationId, health: 'remote_changed', detail: `The provider reports it as ${remote.status ?? 'unknown'}.` };
    }
    if (remote.friendlyName !== input.expectedName(row.organizationId)) {
      return {
        organizationId: row.organizationId,
        health: 'remote_changed',
        detail: `Its name at the provider is now ${remote.friendlyName ?? 'empty'}.`,
      };
    }
    return { organizationId: row.organizationId, health: 'in_sync', detail: null };
  });

  const unmanaged = input.remote.filter((row) => !known.has(row.sid));
  return { findings, unmanaged };
}
