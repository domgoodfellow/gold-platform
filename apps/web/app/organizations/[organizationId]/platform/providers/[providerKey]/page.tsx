import { notFound } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { getDb } from '@/lib/db/server';
import { listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderServicesFor } from '@/lib/domain/providers/services';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { ProviderDetail } from '@/features/platform/providers/provider-detail';
import { ProviderIcon } from '@/features/platform/providers/provider-icon';

export const dynamic = 'force-dynamic';

/**
 * Every Provider without its own account model reaches this one composition. Twilio — the one
 * Provider that has a real account model — keeps its own route at `providers/twilio`, which Next
 * resolves ahead of this dynamic segment for that exact path; nothing here duplicates it.
 */
export default async function ProviderDetailPage({
  params,
}: PageProps<'/organizations/[organizationId]/platform/providers/[providerKey]'>) {
  const { organizationId: goldId, providerKey } = await params;
  await requirePlatformArea(goldId, 'platform.providers');

  if (providerKey === telephonyProviderKey()) notFound(); // has its own route; never duplicated here

  const db = await getDb();
  const [providers, services] = await Promise.all([listProviders(db), listProviderServicesFor(db, providerKey)]);
  const provider = providers.find((p) => p.key === providerKey);
  if (!provider) notFound();

  return (
    <AppPage>
      <PageHeader
        title={provider.label}
        crumbs={[{ label: 'Infrastructure' }]}
        description="Infrastructure GOLD operates to deliver capabilities — each service's own implementation and vendor state, and what GOLD uses it for. Credentials are never read or displayed here."
        meta={<ProviderIcon providerKey={provider.key} label={provider.label} size="large" />}
      />
      <ProviderDetail services={services} />
    </AppPage>
  );
}
