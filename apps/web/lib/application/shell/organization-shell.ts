import { loadPlatformContext } from './platform-context';
import type { Db } from '@/lib/db/types';
import { getBrand } from '@/lib/domain/branding/brand';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { projectHeaderUtilities, withAdministration } from '@/lib/shell';
import { getBusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { projectBusinessNavigation } from './business-navigation';

export async function loadOrganizationShellModel(db: Db, input: { organizationId: string; capabilities: readonly Capability[]; locked: boolean }) {
  const { organizationId, locked } = input;
  const [featureStates, schedulableWork, myOrganizations, { data: userData }, brand, platform] = await Promise.all([
    locked ? Promise.resolve([]) : organizationResolvedFeatureStates(db, { organizationId }),
    // The one answer about the business's shape of work; a locked organization draws no workspaces at all, so it is not asked.
    locked ? Promise.resolve(undefined) : hasSchedulableWork(db, { organizationId }),
    listMyOrganizations(db), db.auth.getUser(), getBrand(db, { organizationId }),
    loadPlatformContext(db, organizationId),
  ]);
  const enabledModules = activeModuleKeys(featureStates);
  const featureAvailability = availableFeatureKeys(featureStates);
  const capabilities = new Set(input.capabilities);
  const businessProfile = locked ? null : await getBusinessProfile(db,organizationId);
  const business = projectBusinessNavigation({ organizationId, enabledModules, featureAvailability, capabilities, schedulableWork },businessProfile);
  return {
    brand,
    businessProfile,
    email: userData.user?.email ?? '',
    switchable: myOrganizations.map((organization) => ({
      id: organization.id, name: organization.name, role: organization.role, operationalState: organization.operationalState,
      manages: organization.capabilities.includes('organization.manage'),
    })),
    sections: platform ? withAdministration(business, organizationId, platform.permissions) : business,
    configGate: { enabledModules, featureAvailability, capabilities, schedulableWork },
    utilities: locked ? [] : projectHeaderUtilities({ organizationId, enabledModules, featureAvailability, capabilities, schedulableWork }),
  };
}
