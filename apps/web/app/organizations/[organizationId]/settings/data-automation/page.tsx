import { redirect } from 'next/navigation';

/** Moved back to `/fields` (custom fields) and `/automations` (automation rules), their canonical workspaces — Settings is one organization Area, not a second application shell (`CLAUDE.md`). */
export default async function DataAndAutomationSettingsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/settings/data-automation'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/fields`);
}
