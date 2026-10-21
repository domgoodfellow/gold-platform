import { redirect } from 'next/navigation';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

/**
 * Redirect-only, never a landing: the sidebar group and the Home's Configure control already list
 * the doors. Sends an old link to the first configuration page the member may open, replacing the
 * address so Back does not return here; `requireWorkspaceConfiguration` is not-found when there is none.
 */
export default async function ConfigurationPage({ params }: PageProps<'/organizations/[organizationId]/sales/configuration'>) {
  const { organizationId } = await params;
  const { sections } = await requireWorkspaceConfiguration(organizationId, 'crm');
  redirect(sections[0].href);
}
