import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { BusinessProfileSettings } from '@/features/tenancy/business-profile-settings';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * The business's own words for records and its workspace page labels and order: the versioned
 * business profile, the same record Setup edits. Changes no access, route or stored record name.
 */
export default async function TerminologySettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/terminology'>) {
  const { organizationId } = await params;
  await requireConfigurationTarget(organizationId, 'terminology');
  return (
    <SettingsPageFrame>
      <SettingsPageHeader title="Words & navigation" />
      <BusinessProfileSettings organizationId={organizationId} />
    </SettingsPageFrame>
  );
}
