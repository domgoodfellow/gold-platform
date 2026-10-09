import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SettingsLanding } from '@/features/settings/settings-landing';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { configurationSummary } from '@/lib/application/settings/configuration-summary';
import { offeredSections } from '@/features/settings/settings-map';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { ButtonLink } from '@/components/controls/button';

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
  const { db, organization } = await requireOrganization(organizationId);
  const [statuses, states, schedulableWork] = await Promise.all([
    configurationSummary(db, organization), organizationResolvedFeatureStates(db, { organizationId }), hasSchedulableWork(db, { organizationId }),
  ]);
  const sections = offeredSections({ enabledModules: activeModuleKeys(states), featureAvailability: availableFeatureKeys(states), capabilities: new Set(organization.capabilities), schedulableWork });

  return (
    <SettingsPageFrame>
      <PageHeader title={areaLabel('settings')} actions={<ButtonLink href={`/organizations/${organizationId}/setup`} tone="secondary" size="small">{organization.operationalState === 'setup' ? 'Continue organization setup' : 'Review readiness'}</ButtonLink>} />
      <Hint className="mb-6 block">
        Configure this business, access, connections, and GildOps plan.
      </Hint>
      <SettingsLanding organizationId={organizationId} statuses={statuses} sections={sections} />
    </SettingsPageFrame>
  );
}
