import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Finance has no configuration area. An old link lands on General, where currency and payment collection are configured. */
export default async function LegacyFinanceConfigurationRoute({ params }: PageProps<'/organizations/[organizationId]/finance/configuration'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/general`);
}
