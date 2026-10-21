import type { ReactNode } from 'react';
import type { WorkspaceKey } from '@/lib/navigation';
import { configurationLayoutSections } from '@/lib/route/workspace-configuration';

export async function WorkspaceConfigurationLayout({ organizationId, workspace, children }: { organizationId: string; workspace: WorkspaceKey; children: ReactNode }) {
  await configurationLayoutSections(organizationId, workspace);
  return children;
}
