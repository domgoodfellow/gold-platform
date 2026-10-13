import { redirect } from 'next/navigation';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';
export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/field/configuration'>) {
 const { organizationId } = await params;
 const { sections } = await requireWorkspaceConfiguration(organizationId, 'field');
 redirect(sections[0].href);
}
