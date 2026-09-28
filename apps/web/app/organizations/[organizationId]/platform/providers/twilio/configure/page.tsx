import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { getDb } from '@/lib/db/server';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { getProviderAccount } from '@/lib/domain/providers/accounts';
import { TwilioConfiguration } from '@/features/platform/providers/twilio-configuration';

export const dynamic = 'force-dynamic';

/**
 * The full-page form of the same configuration the Twilio workspace opens in its Configure drawer.
 * Both render `TwilioConfiguration`; nothing here is a second implementation.
 */
export default async function ConfigureTwilioPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/platform/providers/twilio/configure'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.providers');
  const { account: requested } = await searchParams;
  const db = await getDb();
  const id = typeof requested === 'string' && requested !== 'new' ? requested : null;
  const account = id ? await getProviderAccount(db, id) : null;
  const key = telephonyProviderKey();

  return (
    <AppPage>
      <PageHeader
        title={account ? `Configure ${account.label}` : 'Add a Twilio account'}
        crumbs={[
          ...platformAncestry(goldId, 'providers'),
          { label: 'Providers', href: platformHref(goldId, 'providers') },
          { label: 'Twilio', href: platformHref(goldId, `providers/${key}`) },
        ]}
      />
      <div className="max-w-xl">
        <TwilioConfiguration account={account ?? undefined} />
      </div>
    </AppPage>
  );
}
