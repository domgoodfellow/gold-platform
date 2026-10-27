import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { GettingPaidSection } from '@/features/pricing/getting-paid-section';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/** How this business's customers pay it: trading currency (read here), manual recording and card collection. */
export default async function CustomerPaymentsSettingsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/payments'>) {
  const { organizationId } = await params;
  const { payments } = await searchParams;
  await requireConfigurationTarget(organizationId, 'payments');
  return (
    <SettingsPageFrame>
      <SettingsPageHeader title="Customer payments" />
      <GettingPaidSection organizationId={organizationId} outcome={typeof payments === 'string' ? payments : undefined} />
    </SettingsPageFrame>
  );
}
