import { WorkspaceConfigurationHome } from '@/features/settings/workspace-configuration';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/field/configuration'>) {
  const { organizationId } = await params;
  const configuration = await requireWorkspaceConfiguration(organizationId, 'field');
  return <WorkspaceConfigurationHome organizationId={organizationId} workspace="field" configuration={configuration} />;
}
