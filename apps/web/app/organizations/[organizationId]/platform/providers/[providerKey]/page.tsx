import { notFound } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageHeader } from '@/components/containers/page-header';
import { Section, SectionHeading } from '@/components/containers/section';
import { ViewNav } from '@/components/containers/view-nav';
import { Detail, DefinitionList } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderServicesFor } from '@/lib/domain/providers/services';
import { getDefaultProviderAccount } from '@/lib/domain/providers/accounts';
import { GENERIC_ACCOUNT_PROVIDER_KEYS } from '@/lib/route/provider-environment';
import { AI_CAPABILITY_LABEL, listAiRuntimeAssignments } from '@/lib/domain/ai/runtime';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { ProviderDetail } from '@/features/platform/providers/provider-detail';
import { ProviderIcon } from '@/features/platform/providers/provider-icon';
import { ProviderAccountSummary } from '@/features/platform/providers/accounts/provider-account-summary';
import { ProviderConfiguration } from '@/features/platform/providers/accounts/provider-configuration';

export const dynamic = 'force-dynamic';

const VIEWS = [
  ['overview', 'Overview'],
  ['services', 'Services'],
] as const;
type View = (typeof VIEWS)[number][0];

/**
 * Every Provider without its own account model reaches this one composition. Twilio — the one
 * Provider that has a real account model — keeps its own route at `providers/twilio`, which Next
 * resolves ahead of this dynamic segment for that exact path; nothing here duplicates it.
 */
export default async function ProviderDetailPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/platform/providers/[providerKey]'>) {
  const { organizationId: goldId, providerKey } = await params;
  await requirePlatformArea(goldId, 'platform.providers');

  if (providerKey === telephonyProviderKey()) notFound(); // has its own route; never duplicated here

  const { view: requestedView } = await searchParams;
  const view: View = VIEWS.some(([key]) => key === requestedView) ? (requestedView as View) : 'overview';

  const db = await getDb();
  const [providers, services] = await Promise.all([listProviders(db), listProviderServicesFor(db, providerKey)]);
  const provider = providers.find((p) => p.key === providerKey);
  if (!provider) notFound();

  const hasAccountModel = GENERIC_ACCOUNT_PROVIDER_KEYS.has(providerKey);
  const [account, runtimeAssignments] = await Promise.all([
    hasAccountModel ? getDefaultProviderAccount(db, providerKey) : Promise.resolve(null),
    hasAccountModel ? listAiRuntimeAssignments(db) : Promise.resolve([]),
  ]);
  const runtimeUsage = runtimeAssignments.filter((assignment) => assignment.providerKey === providerKey);

  return (
    <AppPage>
      <PageHeader
        title={provider.label}
        crumbs={[{ label: 'Infrastructure' }]}
        description="Infrastructure GOLD operates to deliver capabilities — each service's own implementation and vendor state, and what GOLD uses it for. Credentials are never read or displayed here."
        meta={<ProviderIcon providerKey={provider.key} label={provider.label} size="large" />}
        configure={hasAccountModel}
      />

      <ViewNav
        label={`${provider.label} views`}
        current={view}
        views={VIEWS.map(([key, label]) => ({ key, label, href: platformHref(goldId, `providers/${providerKey}${key === 'overview' ? '' : `?view=${key}`}`) }))}
      />

      {view === 'services' ? (
        <ProviderDetail services={services} />
      ) : (
        <div className="flex flex-col gap-6">
          {hasAccountModel ? <ProviderAccountSummary account={account} /> : null}

          {hasAccountModel ? (
            <Section>
              <SectionHeading>AI runtime</SectionHeading>
              {runtimeUsage.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Not assigned to any AI capability yet.</p>
              ) : (
                <DefinitionList>
                  {runtimeUsage.map((assignment) => (
                    <Detail key={assignment.capability} label={AI_CAPABILITY_LABEL[assignment.capability]}>
                      {assignment.providerServiceLabel} · {assignment.model}
                    </Detail>
                  ))}
                </DefinitionList>
              )}
              <a
                href={platformHref(goldId, 'ai-runtime')}
                className="mt-2 inline-block text-sm text-muted underline-offset-4 hover:underline"
              >
                Open AI Runtime →
              </a>
            </Section>
          ) : null}
        </div>
      )}

      {hasAccountModel ? (
        <ConfigureRegistrar
          title={`Configure ${provider.label}`}
          settingsHref={platformHref(goldId, `providers/${providerKey}`)}
        >
          <ProviderConfiguration providerKey={providerKey} account={account ?? undefined} />
        </ConfigureRegistrar>
      ) : null}
    </AppPage>
  );
}
