import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { AddSendingDomainForm } from '@/features/communications/email/add-sending-domain-form';
import { SenderAddresses } from '@/features/communications/email/sender-addresses';
import { SendingDomains } from '@/features/communications/email/sending-domains';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { isDnsAutomated, listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { emailSendingStatus, listEmailSenders, type EmailSender, type EmailSendingStatus } from '@/lib/domain/email/sender';
import { listSendingDomains } from '@/lib/domain/email/sending-domains';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Email sending: the one place a business sets up email that goes out in its own name.
 *
 * What it settles, in order: whether this business can send at all and what to do next; the
 * domains it has proved; the addresses beneath them; and which one its booking confirmations,
 * automation messages and service notifications come from. Every state is the same answer a send
 * would get (`app.organization_email_sender`). Provider accounts and credentials are GildOps'
 * own and appear nowhere here. Team invitations are GildOps' own email and need none of this.
 * Which addresses receive into the Inbox stays with Communications (Inbox email).
 */
export default async function EmailSendingSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/email'>) {
  const { organizationId } = await params;
  // Organization configuration: the target's own `organization.manage` gate refuses anyone else.
  const { db } = await requireConfigurationTarget(organizationId, 'email');
  const header = <SettingsPageHeader title="Email sending" />;

  const [status, senders, domains, zones] = await Promise.all([
    emailSendingStatus(db, organizationId),
    listEmailSenders(db, organizationId),
    listSendingDomains(db, organizationId),
    listConnectedDnsZones(db, organizationId),
  ]);

  return (
    <SettingsPageFrame>
      {header}
      <Hint className="mt-1 max-w-prose">
        Email your business sends to customers — booking confirmations, automation messages and service notifications —
        comes from an address on a domain you own. Team invitations come from GildOps and need no setup here.
      </Hint>

      <SendingStatus status={status} senders={senders} />

      <Section className="mt-8">
        <SectionHeading>Sending domains</SectionHeading>
        <Hint className="mt-1 max-w-prose">
          Prove that you own a domain by adding a few DNS records at the company that manages it. If that is an account this
          business has connected, GildOps can publish them for you after you have read them. Your website address is not
          automatically verified for email.
        </Hint>
        <AddSendingDomainForm organizationId={organizationId} />
      </Section>
      <SendingDomains
        organizationId={organizationId}
        domains={domains}
        automatedZone={(domain) => zones.find((zone) => isDnsAutomated(domain, [zone])) ?? null}
      />

      <SenderAddresses
        organizationId={organizationId}
        senders={senders}
        domains={domains.map((domain) => ({ resourceId: domain.resourceId, domain: domain.domain, ready: domain.state === 'ready' }))}
      />

      <Hint className="mt-8">
        Which addresses receive replies into the Inbox is set in{' '}
        <Link className="text-accent-text underline" href={`/organizations/${organizationId}/comms/configuration/email`}>Communications → Inbox email</Link>.
      </Hint>
    </SettingsPageFrame>
  );
}

/** Where this business stands, and the next step, in one sentence. */
function SendingStatus({ status, senders }: { status: EmailSendingStatus; senders: EmailSender[] }) {
  const readyCount = senders.filter((sender) => sender.state === 'ready').length;
  const [heading, sentence] = (() => {
    switch (status.state) {
      case 'ready':
        return ['Ready to send', `Email from your business is sent from ${status.address}.`];
      case 'not_ready':
        return ['Default sender not ready', `${status.address} cannot send yet. ${status.detail ?? ''}`];
      case 'unavailable':
        return ['Sending paused by GildOps', `${status.detail ?? ''} This is on GildOps’ side; you do not need to change anything.`];
      case 'missing':
        return readyCount > 0
          ? ['Choose a default sender', 'You have a ready address. Make it the default below so confirmations and messages can be sent.']
          : ['Not set up yet', 'Until it is, booking confirmations and automation emails are not sent; bookings themselves still work. Add a sending domain, verify it, add an address, then make it the default.'];
    }
  })();
  return (
    <Section className="mt-6" aria-labelledby="email-sending-status">
      <SectionHeading id="email-sending-status">{heading}</SectionHeading>
      <p role="status" className={status.state === 'ready' ? 'mt-1 text-sm' : 'mt-1 text-sm text-danger'}>{sentence}</p>
    </Section>
  );
}
