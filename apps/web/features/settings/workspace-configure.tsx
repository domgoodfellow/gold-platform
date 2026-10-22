import { ConfigureMenu } from '@/components/controls/configure-menu';
import type { ButtonSize } from '@/components/controls/button';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { workspaceConfigureItems, type ConfigureItem, type WorkspaceKey } from '@/lib/navigation';
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
 * hide: nothing, one link named for its page, or a menu of direct links (`ConfigureMenu`). It never
 * opens a page that lists the doors again. Passed to a hub as a node; the hub only places it.
 */
export async function WorkspaceConfigure({ organizationId, workspace, size }: { organizationId: string; workspace: WorkspaceKey; size?: ButtonSize }) {
  return <ConfigureMenu size={size} items={await workspaceConfigureDoors(organizationId, workspace)} />;
}
