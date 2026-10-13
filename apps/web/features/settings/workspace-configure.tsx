import { ConfigureLink } from '@/components/controls/configure-link';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { workspaceConfigureItems, workspaceConfigurationHref, type WorkspaceKey } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The Configure control for a workspace Home, resolved on the server from the configuration
 * registry with the same entitlement + permission gate the Settings directory uses, so a hub can
 * never offer a door Settings would hide. Passed to a hub as a node; the hub only places it.
 */
export async function WorkspaceConfigure({ organizationId, workspace }: { organizationId: string; workspace: WorkspaceKey }) {
  const { db, organization } = await requireOrganization(organizationId);
  const [states, schedulableWork] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    hasSchedulableWork(db, { organizationId }),
  ]);
  const items = workspaceConfigureItems(organizationId, workspace, {
    enabledModules: new Set(activeModuleKeys(states)),
    featureAvailability: new Set(availableFeatureKeys(states)),
    capabilities: new Set(organization.capabilities),
    schedulableWork,
  });
  return items.length ? <ConfigureLink href={workspaceConfigurationHref(organizationId, workspace)} label="Configuration" title="Configuration" /> : null;
}
