import { redirect } from 'next/navigation';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';
export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/sales/configuration'>) {
 const { organizationId } = await params;
 const { sections } = await requireWorkspaceConfiguration(organizationId, 'crm');
 redirect(sections[0].href);
}
