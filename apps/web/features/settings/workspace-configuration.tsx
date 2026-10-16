import type { ReactNode } from 'react';
import { NavigationList } from '@/components/navigation/navigation-list';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { WORKSPACES, AREAS, areaHref, areaEntitled, areaVisibleTo, type WorkspaceKey } from '@/lib/navigation';
import { requireWorkspaceConfiguration, configurationLayoutSections } from '@/lib/route/workspace-configuration';

export async function WorkspaceConfigurationLayout({ organizationId, workspace, children }: { organizationId: string; workspace: WorkspaceKey; children: ReactNode }) {
  await configurationLayoutSections(organizationId, workspace);
  return children;
}

/**
 * The page a workspace's Configuration parent opens. One eligible destination goes straight to it;
 * several are listed from the same registry results the sidebar group uses. The page passes in
 * its own `requireWorkspaceConfiguration` result, so authorization stays visible at the route.
 */
export function WorkspaceConfigurationHome({ organizationId, workspace, configuration: { gate, sections } }: { organizationId: string; workspace: WorkspaceKey; configuration: Awaited<ReturnType<typeof requireWorkspaceConfiguration>> }) {
  if (sections.length === 1) redirect(sections[0].href);
  const owner = WORKSPACES.find(candidate => candidate.key === workspace)!;
  const home = AREAS.find(area => area.segment === owner.home)!;
  const mayOperate = areaEntitled(home, gate.enabledModules, gate.featureAvailability) && areaVisibleTo(home, gate.capabilities);
  return <AppPage width="form">
    <PageHeader title="Configuration" crumbs={[{ label: owner.label, href: mayOperate ? areaHref(organizationId, owner.home) : undefined }]} />
    <NavigationList label={`${owner.label} configuration`} items={sections.map(section => ({ key: section.key, title: section.label, href: section.href, chevron: true }))} />
  </AppPage>;
}
