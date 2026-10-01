import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SettingsLanding } from '@/features/settings/settings-landing';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Settings itself: a chooser between five destinations, not a tab bar that follows the reader
 * into every page beneath it. Organization — the configuration directory `SettingsIndex` used to
 * render here directly — is now one destination among Account, Access, Connections and Plan &
 * usage, at `/organizations/{id}/settings/organization`.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <SettingsPageFrame>
      <PageHeader title={areaLabel('settings')} />
      <Hint className="mb-6 block">
        Configure this business, access, connections, and GildOps plan.
      </Hint>
      <SettingsLanding organizationId={organizationId} />
    </SettingsPageFrame>
  );
}
