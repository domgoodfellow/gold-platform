import { redirect } from 'next/navigation';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/comms/configuration'>) {
  const { organizationId } = await params;
  const { sections } = await requireWorkspaceConfiguration(organizationId, 'communications');
  redirect(sections[0].href);
}
