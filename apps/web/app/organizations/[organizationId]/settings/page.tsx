import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState } from '@/components/containers/section';
import { SettingsIndex } from '@/features/settings/settings-index';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { offeredSections } from '@/features/settings/settings-map';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Settings is the map of where this business is configured — an index into focused pages, not a
 * form and not a second navigation rail. What it lists comes from `settings-map.ts`, gated by the
 * same entitlement and capability predicates the sidebar uses, so it never offers a door the
 * sidebar would have hidden.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const featureStates = await organizationResolvedFeatureStates(db, { organizationId });
  const sections = offeredSections({
    enabledModules: new Set(activeModuleKeys(featureStates)),
    featureAvailability: new Set(availableFeatureKeys(featureStates)),
    capabilities: new Set(organization.capabilities),
  });

  return (
    <SettingsPageFrame>
      <PageHeader
        title={areaLabel('settings')}
        description={`Where ${organization.name} is configured. Changes here apply to this business, not to your personal account.`}
      />
      {sections.length === 0 ? (
        <EmptyState>Your role, {organization.role}, does not configure anything in this business.</EmptyState>
      ) : (
        <SettingsIndex organizationId={organizationId} sections={sections} />
      )}
    </SettingsPageFrame>
  );
}
