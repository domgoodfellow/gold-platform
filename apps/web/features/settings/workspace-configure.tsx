import { ConfigureLink } from '@/components/controls/configure-link';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { workspaceConfigureItems, workspaceConfigurationHref, type ConfigureItem, type WorkspaceKey } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The configuration doors this member may open for a workspace, resolved from the configuration
 * registry with the same entitlement + permission gate the Settings directory uses. A page that
 * points at one concern (the Dialer's "Set up numbers") reads it here rather than holding a path.
 */
export async function workspaceConfigureDoors(organizationId: string, workspace: WorkspaceKey): Promise<ConfigureItem[]> {
  const { db, organization } = await requireOrganization(organizationId);
  const [states, schedulableWork] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    hasSchedulableWork(db, { organizationId }),
  ]);
  return workspaceConfigureItems(organizationId, workspace, {
    enabledModules: new Set(activeModuleKeys(states)),
    featureAvailability: new Set(availableFeatureKeys(states)),
    capabilities: new Set(organization.capabilities),
    schedulableWork,
  });
}

/**
 * The Configure control for a workspace Home, so a hub can never offer a door Settings would
 * hide. Passed to a hub as a node; the hub only places it.
 */
export async function WorkspaceConfigure({ organizationId, workspace }: { organizationId: string; workspace: WorkspaceKey }) {
  const items = await workspaceConfigureDoors(organizationId, workspace);
  return items.length ? <ConfigureLink href={workspaceConfigurationHref(organizationId, workspace)} label="Configuration" title="Configuration" /> : null;
}
