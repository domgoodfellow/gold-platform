import { WorkspaceConfigurationHome } from '@/features/settings/workspace-configuration';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/sales/configuration'>) {
  const { organizationId } = await params;
  const configuration = await requireWorkspaceConfiguration(organizationId, 'crm');
  return <WorkspaceConfigurationHome organizationId={organizationId} workspace="crm" configuration={configuration} />;
}
