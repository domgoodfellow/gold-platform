import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { defaultSettingsHref, projectSettingsNav } from '@/lib/settings-nav';

export const dynamic = 'force-dynamic';

/**
 * Settings has no page of its own: the sidebar is the directory. Opening it lands on the first
 * destination this member may use — General for an administrator — and every section stays a
 * deep link.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [states, schedulableWork] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }), hasSchedulableWork(db, { organizationId }),
  ]);
  redirect(defaultSettingsHref(projectSettingsNav(organizationId, {
    enabledModules: activeModuleKeys(states),
    featureAvailability: availableFeatureKeys(states),
    capabilities: new Set(organization.capabilities),
    schedulableWork,
  })));
}
