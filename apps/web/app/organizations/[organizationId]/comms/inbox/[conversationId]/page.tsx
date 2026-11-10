import { notFound } from 'next/navigation';
import { ConversationDetailView } from '@/features/communications/inbox/conversation-detail';
import { currentMembershipId, getConversationDetail, listAssignableMembers } from '@/lib/domain/reception/inbox';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { areaAvailable } from '@/lib/navigation';
import { listCallPage } from '@/lib/domain/reception/calls';
import { DialerRecentCalls } from '@/features/communications/voice/dialer-context';
import { ButtonLink } from '@/components/controls/button';
import { formatPhoneForDisplay } from '@/lib/display/phone';

export const dynamic = 'force-dynamic';

/**
 * One conversation, in the one canonical screen for every channel. Read through the domain query under
 * the caller's own session, so another business's conversation — by id, by guess — is simply not there:
 * the same answer as a conversation that never existed.
 */
export default async function ConversationPage({ params }: PageProps<'/organizations/[organizationId]/comms/inbox/[conversationId]'>) {
  const { organizationId, conversationId } = await params;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'comms-inbox');

  const [detail, members, myMembershipId] = await Promise.all([
    getConversationDetail(db, { organizationId, conversationId }),
    listAssignableMembers(db, { organizationId }),
    currentMembershipId(db, { organizationId }),
  ]);
  if (!detail) notFound();
  const senders = organization.capabilities.includes('message.send') ? await messagingSenders(db, { organizationId }) : { numbers: [], senders: [] };
  const conversation = detail.conversation;
  const contact = detail.resolution.state === 'resolved' ? detail.resolution.customer : null;
  const calling = areaAvailable('calls', { enabled: gate.enabledModules, ...gate });
  const phone = contact?.phone ?? (conversation.channel === 'sms' ? conversation.externalNumber : null);
  const callHref = calling && organization.capabilities.includes('call.place') && phone && /^\+[1-9][0-9]{7,14}$/.test(phone) ? `/organizations/${organizationId}/calls?to=${encodeURIComponent(phone)}` : undefined;
  const calls = contact && calling ? await listCallPage(db, { organizationId, filter: { customerId: contact.id }, limit: 3 }) : null;
  const mayReply = conversation.channel === 'sms'
    ? senders.numbers.some(number => number.id === conversation.phoneNumberId)
    : senders.senders.some(sender => sender.id === conversation.emailIdentityId);

  return (
    <ConversationDetailView
      // A different conversation is a different screen, with its own composer and its own controls.
      key={conversationId}
      organizationId={organizationId}
      detail={detail}
      callHref={callHref}
      contactContext={contact ? <>
        <h2 className="text-sm font-semibold">{contact.name}</h2>
        <dl className="space-y-2 text-sm"><div><dt className="text-xs text-muted">Phone</dt><dd className="break-words">{contact.phone ? formatPhoneForDisplay(contact.phone) : 'Not recorded'}</dd></div><div><dt className="text-xs text-muted">Email</dt><dd className="break-words">{contact.email ?? 'Not recorded'}</dd></div></dl>
        <ButtonLink size="small" href={`/organizations/${organizationId}/crm/contacts/${contact.id}`}>Open contact</ButtonLink>
        {calls ? <section className="space-y-2"><h3 className="text-sm font-medium">Recent calls</h3><DialerRecentCalls organizationId={organizationId} timeZone={organization.timezone} calls={calls.items} /><ButtonLink tone="text" size="small" href={`/organizations/${organizationId}/crm/contacts/${contact.id}?section=activity&view=calls`}>Call history</ButtonLink></section> : null}
      </> : undefined}
      support={<RelatedSupport organizationId={organizationId} kind="conversation" recordId={conversationId} customerId={conversation.customerId} customerName={detail.resolution.state==='resolved'?detail.resolution.customer.name:undefined}/>}
      members={members}
      myMembershipId={myMembershipId}
      mayHandle={organization.capabilities.includes('message.send')}
      mayReply={mayReply}
      mayCreateCustomer={organization.capabilities.includes('customer.create')}
    />
  );
}
import { RelatedSupport } from '@/features/support/related';
