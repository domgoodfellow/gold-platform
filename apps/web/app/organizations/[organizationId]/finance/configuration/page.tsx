import { redirect } from 'next/navigation';
import { configurationTargetOffered } from '@/lib/route/workspace-configuration';
import { legacyPaymentSettingsHref } from '@/lib/route/settings';

export const dynamic = 'force-dynamic';

/** Finance has no configuration area. An old link lands on Customer payments (or General for a member who cannot manage it). */
export default async function LegacyFinanceConfigurationRoute({ params }: PageProps<'/organizations/[organizationId]/finance/configuration'>) {
  const { organizationId } = await params;
  redirect(legacyPaymentSettingsHref(organizationId, await configurationTargetOffered(organizationId, 'payments')));
}
