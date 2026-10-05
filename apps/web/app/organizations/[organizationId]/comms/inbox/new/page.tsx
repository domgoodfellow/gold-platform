import { NewConversation } from '@/features/communications/inbox/new-conversation';
import { listSendableEmailIdentities } from '@/lib/domain/email/messages';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { requireOrganization } from '@/lib/route/organization';

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
  const { db, organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('message.send')) {
    return <div className="p-4 text-sm text-muted">Your role cannot start conversations here.</div>;
  }

  const [numbers, senders] = await Promise.all([listPhoneNumbers(db, { organizationId }), listSendableEmailIdentities(db, { organizationId })]);
  const outbound = numbers.filter((number) => number.smsOutboundEnabled && number.lifecycle === 'active' && (number.origin === 'provisioned' || number.origin === 'external'));

  return (
    <NewConversation
      organizationId={organizationId}
      numbers={outbound.map((number) => ({ id: number.id, e164: number.e164, label: number.label }))}
      senders={senders.map((sender) => ({ id: sender.id, address: sender.address, displayName: sender.displayName }))}
      initialChannel={channel === 'email' ? 'email' : 'sms'}
    />
  );
}
