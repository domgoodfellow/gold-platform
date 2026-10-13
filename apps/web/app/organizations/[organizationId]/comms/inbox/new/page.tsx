import { NewConversation } from '@/features/communications/inbox/new-conversation';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Start a conversation with somebody new. The numbers and addresses offered are the ones that can send
 * right now — a convenience; the database decides again when the message is queued, and the page carries
 * no address to type.
 */
export default async function NewConversationPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/comms/inbox/new'>) {
  const { organizationId } = await params;
  const { channel } = await searchParams;
  const { db, organization } = await requireOperatingArea(organizationId, 'comms-inbox');

  if (!organization.capabilities.includes('message.send')) {
    return <div className="p-4 text-sm text-muted">Your role cannot start conversations here.</div>;
  }

  const { numbers: outbound, senders } = await messagingSenders(db, { organizationId });

  return (
    <NewConversation
      organizationId={organizationId}
      numbers={outbound.map((number) => ({ id: number.id, e164: number.e164, label: number.label }))}
      senders={senders.map((sender) => ({ id: sender.id, address: sender.address, displayName: sender.displayName }))}
      initialChannel={channel === 'email' ? 'email' : 'sms'}
    />
  );
}
