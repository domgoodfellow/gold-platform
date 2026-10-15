import type { ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { WORKSPACES, AREAS, areaHref, areaEntitled, areaVisibleTo, type WorkspaceKey } from '@/lib/navigation';
import { requireWorkspaceConfiguration, configurationLayoutSections } from '@/lib/route/workspace-configuration';

export async function WorkspaceConfigurationLayout({ organizationId, workspace, children }: { organizationId: string; workspace: WorkspaceKey; children: ReactNode }) {
  await configurationLayoutSections(organizationId, workspace);
  return children;
}

export async function WorkspaceConfigurationHome({ organizationId, workspace }: { organizationId: string; workspace: WorkspaceKey }) {
  const { gate } = await requireWorkspaceConfiguration(organizationId, workspace);
  const owner = WORKSPACES.find(candidate => candidate.key === workspace)!;
  const home = AREAS.find(area => area.segment === owner.home)!;
  const mayOperate = areaEntitled(home, gate.enabledModules, gate.featureAvailability) && areaVisibleTo(home, gate.capabilities);
  return <AppPage><PageHeader title="Configuration" crumbs={[{ label: owner.label, href: mayOperate ? areaHref(organizationId, owner.home) : undefined }]} />
    <p className="text-sm text-muted">Branding, public profile and domains are shared organization settings. The Configuration group in the sidebar opens their canonical editors. Website, form and template editing remains in Studio.</p>
    {mayOperate ? <ButtonLink className="mt-4" href={areaHref(organizationId, owner.home)} tone="text">Open {owner.label}</ButtonLink> : null}
  </AppPage>;
}
