import { WorkspaceConfigurationHome } from '@/features/settings/workspace-configuration';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/ai/configuration'>) {
  const { organizationId } = await params;
  const configuration = await requireWorkspaceConfiguration(organizationId, 'ai');
  return <WorkspaceConfigurationHome organizationId={organizationId} workspace="ai" configuration={configuration} />;
}
