import { PageHeader } from '@/components/containers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listMessageTemplates } from '@/lib/domain/automation/templates';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { MessagesView } from '@/features/automations/templates/messages-view';

export const dynamic = 'force-dynamic';

/** Messages, a page of the Automations workspace: the words a rule sends, which belong to the business. */
export default async function AutomationMessagesPage({
  params,
}: PageProps<'/organizations/[organizationId]/automations/messages'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const templates = await listMessageTemplates(db, { organizationId });

  return (
    <>
      <PageHeader title={areaLabel('automation-messages')} crumbs={workspaceAncestry(organizationId, 'automation-messages')} />
      <MessagesView
        organizationId={organizationId}
        templates={templates}
        mayManage={organization.capabilities.includes('automation.manage')}
        role={organization.role}
      />
    </>
  );
}
