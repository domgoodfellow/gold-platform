import type { Db } from '@/lib/db/types';
import { telephonyBootstrapConfigured, telephonyProviderKey } from '@/lib/adapters/telephony';
import { listProviderAccounts, listProviderOrganizationStandings } from '@/lib/domain/providers/accounts';
import { localHealth } from '@/lib/domain/providers/reconciliation';
import { providerReadiness } from '@/lib/domain/providers/status';

export async function loadTwilioProvider(db: Db) {
  const [accounts, standings] = await Promise.all([
    listProviderAccounts(db, { providerKey: telephonyProviderKey() }),
    listProviderOrganizationStandings(db, { providerKey: telephonyProviderKey() }),
  ]);
  const bootstrapConfigured = telephonyBootstrapConfigured();
  const readiness = providerReadiness({ accounts, bootstrapConfigured, apiConfigured: Boolean(process.env.GOLD_API_URL) });
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const primary = accounts.find((account) => account.isDefault) ?? activeAccounts[0] ?? accounts[0];
  const bound = standings.filter((row) => row.bindingId);
  const standingCountByAccount = new Map<string, number>();
  for (const row of standings) {
    if (row.providerAccountId) standingCountByAccount.set(row.providerAccountId, (standingCountByAccount.get(row.providerAccountId) ?? 0) + 1);
  }
  return {
    accounts,
    standings,
    readiness,
    primary,
    bound,
    attention: standings.filter((row) => ['failed', 'remote_missing', 'remote_changed'].includes(localHealth(row))),
    accountLabel: new Map(accounts.map((account) => [account.id, account.label])),
    organizationNames: Object.fromEntries(standings.map((row) => [row.organizationId, row.organizationName])),
    standingCountByAccount,
    activeBoundCount: bound.filter((row) => row.bindingStatus === 'active').length,
    unprovisionedCount: standings.length - bound.length,
    resourceTotal: bound.reduce((sum, row) => sum + row.resourceCount, 0),
    bootstrapConfigured,
  };
}

export type TwilioProviderModel = Awaited<ReturnType<typeof loadTwilioProvider>>;
