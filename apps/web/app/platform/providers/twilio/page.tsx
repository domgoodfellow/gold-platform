import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { loadTwilioProvider } from '@/lib/application/platform/twilio-provider';
import { TwilioProviderScreen, type Tab } from '@/features/platform/providers/twilio-provider-screen';

export const dynamic = 'force-dynamic';

const TABS: Tab[] = ['overview', 'accounts', 'organizations'];

export default async function TwilioProviderPage({ params, searchParams }: PageProps<'/platform/providers/twilio'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.providers');
  const { tab: requested } = await searchParams;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview';
  const model = await loadTwilioProvider(await getDb());
  return <TwilioProviderScreen goldId={goldId} tab={tab} model={model} />;
}
