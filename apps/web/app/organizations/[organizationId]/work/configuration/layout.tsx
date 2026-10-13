import type { ReactNode } from 'react';
import { WorkspaceConfigurationLayout } from '@/features/settings/workspace-configuration';
export default async function ConfigurationLayout({ params, children }: { params: Promise<{organizationId:string}>; children: ReactNode }) {
 const { organizationId } = await params;
 return <WorkspaceConfigurationLayout organizationId={organizationId} workspace="field">{children}</WorkspaceConfigurationLayout>;
}
