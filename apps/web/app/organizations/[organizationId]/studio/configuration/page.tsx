import { WorkspaceConfigurationHome } from '@/features/settings/workspace-configuration';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/studio/configuration'>) {
  const { organizationId } = await params;
  const configuration = await requireWorkspaceConfiguration(organizationId, 'studio');
  return <WorkspaceConfigurationHome organizationId={organizationId} workspace="studio" configuration={configuration} />;
}
