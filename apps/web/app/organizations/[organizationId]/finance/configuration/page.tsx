import { WorkspaceConfigurationHome } from '@/features/settings/workspace-configuration';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/finance/configuration'>) {
  const { organizationId } = await params;
  const configuration = await requireWorkspaceConfiguration(organizationId, 'finance');
  return <WorkspaceConfigurationHome organizationId={organizationId} workspace="finance" configuration={configuration} />;
}
