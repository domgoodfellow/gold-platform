import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { telephonyBootstrapConfigured, telephonyProviderKey } from '@/lib/adapters/telephony';
import { listProviderRates, listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderAccounts } from '@/lib/domain/providers/accounts';
import { listProviderBindingSummary } from '@/lib/domain/providers/bindings';
import { listProviderServices } from '@/lib/domain/providers/services';
import { CREDENTIAL_LABEL, providerStages } from '@/lib/domain/providers/stages';
import { listAiRuntimeAssignments } from '@/lib/domain/ai/runtime';
import { GENERIC_ACCOUNT_PROVIDER_KEYS, platformEmailOperationalStatus } from '@/lib/route/provider-environment';
import { ProviderIcon } from '@/features/platform/providers/provider-icon';

export const dynamic = 'force-dynamic';

export default async function ProvidersPage({ params }: PageProps<'/platform/providers'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.providers');
  const db = await getDb();
  const [providers, rates, bindings, accounts, services, assignments] = await Promise.all([
    listProviders(db),
    listProviderRates(db),
    listProviderBindingSummary(db),
    listProviderAccounts(db),
    listProviderServices(db),
    listAiRuntimeAssignments(db),
  ]);

  // Six separate facts per provider (`stages.ts`): a catalogue row says none of the others. An
  // account adapter exists only for the providers this deployment built account handling for.
  const twilioKey = telephonyProviderKey();
  const stagesOf = (providerKey: string) => {
    const own = accounts.filter((account) => account.providerKey === providerKey);
    return providerStages({
      accountAdapter: providerKey === twilioKey || GENERIC_ACCOUNT_PROVIDER_KEYS.has(providerKey),
      accounts: own,
      services: services.filter((service) => service.providerKey === providerKey),
      runtimeAssignments: assignments.filter((assignment) => assignment.providerKey === providerKey).length,
      deploymentCredential:
        providerKey === twilioKey
          ? telephonyBootstrapConfigured()
          : providerKey === 'resend'
            ? platformEmailOperationalStatus(own.find((account) => account.isDefault) ?? own[0] ?? null).source === 'environment'
            : false,
    });
  };

  return (
    <AppPage>
      <PageHeader title="Providers" crumbs={platformAncestry(goldId, 'providers')} />
      <Hint className="mb-4 block">Credentials are never read or displayed here.</Hint>
      <DataTable
        rows={providers}
        rowKey={(provider) => provider.key}
        empty="No providers recorded."
        columns={[
          {
            key: 'provider',
            header: 'Provider',
            emphasis: 'primary',
            cell: (provider) => (
              <Link
                href={platformHref(goldId, `providers/${provider.key}`)}
                className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
              >
                <ProviderIcon providerKey={provider.key} label={provider.label} size="small" />
                {provider.label}
              </Link>
            ),
          },
          {
            key: 'implementation',
            header: 'Services implemented',
            cell: (provider) => {
              const own = services.filter((service) => service.providerKey === provider.key);
              if (own.length === 0) return <span className="text-subtle">None catalogued</span>;
              const implemented = own.filter((service) => service.implementationState === 'available').length;
              return (
                <Badge tone={implemented > 0 ? 'success' : 'neutral'}>
                  {implemented} of {own.length}
                </Badge>
              );
            },
          },
          {
            key: 'account',
            header: 'Account',
            cell: (provider) => {
              const stages = stagesOf(provider.key);
              if (!stages.accountAdapter) return <span className="text-subtle">No adapter</span>;
              return (
                <Badge tone={stages.credential === 'verified' || stages.credential === 'deployment' ? 'success' : stages.credential === 'failed' ? 'danger' : 'neutral'}>
                  {CREDENTIAL_LABEL[stages.credential]}
                </Badge>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            cell: (provider) => {
              const stages = stagesOf(provider.key);
              return (
                <div>
                  <Badge tone={stages.operational ? 'success' : 'neutral'}>{stages.operational ? 'Operational' : 'Not operational'}</Badge>
                  {stages.blocker ? <span className="mt-1 block text-xs text-muted-foreground">{stages.blocker}</span> : null}
                </div>
              );
            },
          },
          {
            key: 'organizations',
            header: 'Organizations bound',
            numeric: true,
            cell: (provider) => {
              const summary = bindings.get(provider.key);
              const failed = summary?.failed ?? 0;
              return (
                <span>
                  {summary?.total ?? 0}
                  {failed > 0 ? <span className="text-danger"> · {failed} failed</span> : null}
                </span>
              );
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
