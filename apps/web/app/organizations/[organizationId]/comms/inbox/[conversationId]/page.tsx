import { notFound } from 'next/navigation';
import { ConversationDetailView } from '@/features/communications/inbox/conversation-detail';
import { currentMembershipId, getConversationDetail, listAssignableMembers } from '@/lib/domain/reception/inbox';
import { requireOrganization } from '@/lib/route/organization';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';

export const dynamic = 'force-dynamic';

/**
 * One conversation, in the one canonical screen for every channel. Read through the domain query under
 * the caller's own session, so another business's conversation — by id, by guess — is simply not there:
 * the same answer as a conversation that never existed.
 */
export default async function ConversationPage({ params }: PageProps<'/organizations/[organizationId]/comms/inbox/[conversationId]'>) {
  const { organizationId, conversationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [detail, members, myMembershipId] = await Promise.all([
    getConversationDetail(db, { organizationId, conversationId }),
    listAssignableMembers(db, { organizationId }),
    currentMembershipId(db, { organizationId }),
  ]);
  if (!detail) notFound();
  const senders = organization.capabilities.includes('message.send') ? await messagingSenders(db, { organizationId }) : { numbers: [], senders: [] };
  const conversation = detail.conversation;
  const mayReply = conversation.channel === 'sms'
    ? senders.numbers.some(number => number.id === conversation.phoneNumberId)
    : senders.senders.some(sender => sender.id === conversation.emailIdentityId);

  return (
    <ConversationDetailView
      // A different conversation is a different screen, with its own composer and its own controls.
      key={conversationId}
      organizationId={organizationId}
      detail={detail}
      members={members}
      myMembershipId={myMembershipId}
      mayHandle={organization.capabilities.includes('message.send')}
      mayReply={mayReply}
      mayCreateCustomer={organization.capabilities.includes('customer.create')}
    />
  );
}
