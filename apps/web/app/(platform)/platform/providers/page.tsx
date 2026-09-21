import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { telephonyBootstrapConfigured, telephonyProviderKey } from '@/lib/adapters/telephony';
import { listProviderRates, listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderAccounts } from '@/lib/domain/providers/accounts';
import { listProviderBindingSummary } from '@/lib/domain/providers/bindings';
import { providerReadiness } from '@/lib/domain/providers/status';
import { ReadinessBadge } from '@/features/platform/providers/health-badge';

export const dynamic = 'force-dynamic';

/** Deployment-level readiness for providers that have no account model yet. */
function environmentState(key: string): 'configured' | 'not configured' | 'not implemented' {
  if (key === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured';
  if (key === 'resend') return process.env.RESEND_API_KEY ? 'configured' : 'not configured';
  return 'not implemented';
}

export default async function ProvidersPage() {
  const db = await getDb();
  const [providers, rates, bindings, accounts] = await Promise.all([
    listProviders(db),
    listProviderRates(db),
    listProviderBindingSummary(db),
    listProviderAccounts(db),
  ]);

  // A provider has a detail workspace the day it has an account model to operate; today that is
  // the telephony provider alone, and no other row pretends otherwise.
  const detailKey = telephonyProviderKey();
  const apiConfigured = Boolean(process.env.GOLD_API_URL);

  return (
    <AppPage>
      <PageHeader
        title="Providers"
        crumbs={[{ label: 'Infrastructure' }]}
        description="Infrastructure GOLD operates to deliver capabilities: each provider’s readiness, the organizations that depend on it, and what needs attention. Credentials are never read or displayed here."
      />
      <DataTable
        rows={providers}
        rowKey={(provider) => provider.key}
        empty="No providers recorded."
        columns={[
          {
            key: 'provider',
            header: 'Provider',
            emphasis: 'primary',
            cell: (provider) =>
              provider.key === detailKey ? (
                <Link href={`/platform/providers/${provider.key}`} className="font-medium underline-offset-4 hover:underline">
                  {provider.label}
                </Link>
              ) : (
                <div>
                  <span className="font-medium">{provider.label}</span>
                  <span className="block text-xs text-muted-foreground">{provider.key}</span>
                </div>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (provider) => {
              if (provider.key === detailKey) {
                const readiness = providerReadiness({
                  accounts: accounts.filter((account) => account.providerKey === provider.key),
                  bootstrapConfigured: telephonyBootstrapConfigured(),
                  apiConfigured,
                });
                return (
                  <div>
                    <ReadinessBadge state={readiness.state} />
                    <span className="mt-1 block text-xs text-muted-foreground">{readiness.summary}</span>
                  </div>
                );
              }
              const state = environmentState(provider.key);
              return <Badge tone={state === 'configured' ? 'success' : 'neutral'}>{state}</Badge>;
            },
          },
          {
            key: 'accounts',
            header: 'GOLD accounts',
            numeric: true,
            cell: (provider) => {
              const own = accounts.filter((account) => account.providerKey === provider.key);
              return own.length === 0 ? '—' : `${own.filter((a) => a.verificationState === 'verified').length} / ${own.length} verified`;
            },
          },
          {
            key: 'organizations',
            header: 'Organizations bound',
            numeric: true,
            cell: (provider) => bindings.get(provider.key)?.total ?? 0,
          },
          {
            key: 'failures',
            header: 'Failed',
            numeric: true,
            cell: (provider) => {
              const failed = bindings.get(provider.key)?.failed ?? 0;
              return failed > 0 ? <span className="text-danger">{failed}</span> : 0;
            },
          },
          {
            key: 'meters',
            header: 'Costed meters',
            cell: (provider) => {
              const meters = [...new Set(rates.filter((rate) => rate.providerKey === provider.key).map((rate) => rate.meterId))];
              return meters.length ? meters.join(', ') : 'No wholesale rates';
            },
          },
        ]}
      />
    </AppPage>
  );
}
