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
export default async function ConfigureTwilioPage({ searchParams }: PageProps<'/platform/providers/twilio/configure'>) {
  const { account: requested } = await searchParams;
  const db = await getDb();
  const id = typeof requested === 'string' && requested !== 'new' ? requested : null;
  const account = id ? await getProviderAccount(db, id) : null;
  const key = telephonyProviderKey();

  return (
    <AppPage width="full">
      <PageHeader
        title={account ? `Configure ${account.label}` : 'Add a Twilio account'}
        crumbs={[
          { label: 'Infrastructure' },
          { label: 'Providers', href: '/platform/providers' },
          { label: 'Twilio', href: `/platform/providers/${key}` },
        ]}
      />
      <div className="max-w-xl">
        <TwilioConfiguration account={account ?? undefined} />
      </div>
    </AppPage>
  );
}
