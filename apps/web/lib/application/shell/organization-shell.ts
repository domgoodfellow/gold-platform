import type { Db } from '@/lib/db/types';
import { getBrand } from '@/lib/domain/branding/brand';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { isGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { businessSettingsOffered, projectShell } from '@/lib/shell';

export async function loadOrganizationShellModel(db: Db, input: { organizationId: string; capabilities: readonly Capability[]; locked: boolean }) {
  const { organizationId, locked } = input;
  const [featureStates, myOrganizations, staff, { data: userData }, gold, brand] = await Promise.all([
    locked ? Promise.resolve([]) : organizationResolvedFeatureStates(db, { organizationId }),
    listMyOrganizations(db), isPlatformStaff(db), db.auth.getUser(), isGoldInternalOrganization(db, { organizationId }), getBrand(db, { organizationId }),
  ]);
  const platform = staff && gold ? await platformPermissions(db) : null;
  const enabledModules = activeModuleKeys(featureStates);
  const featureAvailability = availableFeatureKeys(featureStates);
  const capabilities = new Set(input.capabilities);
  return {
    platform,
    brand,
    email: userData.user?.email ?? '',
    switchable: myOrganizations.map((organization) => ({
      id: organization.id, name: organization.name, role: organization.role, operationalState: organization.operationalState,
    })),
    sections: projectShell({ organizationId, enabledModules, featureAvailability, capabilities, platform }),
    settingsOffered: businessSettingsOffered({ enabledModules, featureAvailability, capabilities }),
  };
}
