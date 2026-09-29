import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { MessagesInbox } from '@/features/communications/messaging/messages-inbox';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Messages: one conversation history, whatever transport actually carried a given message
 * (`Message.transport`). SMS is the only transport this deployment's resolver ever reaches today
 * — MMS and RCS are real vocabulary in the schema, not yet a real send path, so nothing here
 * claims either.
 */
export default async function CommsMessagesPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/messages'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const numbers = await listPhoneNumbers(db, { organizationId });
  const outboundNumbers = numbers.filter((number) => number.outboundEnabled && number.lifecycle === 'active');

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('comms-messages')}
        crumbs={workspaceAncestry(organizationId, 'comms-messages')}
        description="Text conversations with customers."
      />
      <MessagesInbox
        organizationId={organizationId}
        numbers={outboundNumbers.map((number) => ({ id: number.id, e164: number.e164, label: number.label }))}
        mayCompose={organization.capabilities.includes('message.send')}
      />
    </AppPage>
  );
}
