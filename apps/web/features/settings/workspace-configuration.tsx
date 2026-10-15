import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { FOCUS_RING, cx } from '@/components/class-names';
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
    <ul className="divide-y divide-border">
      {sections.map(section => <li key={section.key}>
        <Link href={section.href} className={cx(FOCUS_RING, 'flex min-h-11 items-center rounded-md px-2 py-3 text-sm hover:bg-hover')}>{section.label}</Link>
      </li>)}
    </ul>
  </AppPage>;
}
