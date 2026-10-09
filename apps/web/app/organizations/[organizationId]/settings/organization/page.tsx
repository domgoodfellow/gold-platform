import { EmptyState } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { SettingsIndex } from '@/features/settings/settings-index';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { offeredSections } from '@/features/settings/settings-map';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref } from '@/lib/route/settings';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';

export const dynamic = 'force-dynamic';

/**
 * The organization configuration directory — an index into focused pages, not a form and not a
 * second navigation rail. What it lists comes from `settings-map.ts`, gated by the same
 * entitlement and capability predicates the sidebar uses, so it never offers a door the sidebar
 * would have hidden. Reached from the Settings landing page as one of its five destinations.
 */
export default async function OrganizationSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/organization'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [featureStates, schedulableWork] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }), hasSchedulableWork(db, { organizationId }),
  ]);
  const sections = offeredSections({
    enabledModules: new Set(activeModuleKeys(featureStates)),
    featureAvailability: new Set(availableFeatureKeys(featureStates)),
    capabilities: new Set(organization.capabilities),
    schedulableWork,
  });

  return (
    <SettingsPageFrame>
      <PageHeader title="Organization" crumbs={[{ label: 'Settings', href: settingsLandingHref(organizationId) }]} />
      {sections.length === 0 ? (
        <EmptyState>Your role, {organization.role}, does not configure anything in this business.</EmptyState>
      ) : (
        <SettingsIndex organizationId={organizationId} sections={sections} />
      )}
    </SettingsPageFrame>
  );
}
