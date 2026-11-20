import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { CardSection } from '@/components/surfaces/card';
import { SenderAddresses } from '@/features/communications/email/sender-addresses';
import { ReplyToForm, TestSendForm } from '@/features/communications/email/reply-to-and-test';
import { SendingDomains } from '@/features/communications/email/sending-domains';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { isDnsAutomated, listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { emailSendingStatus, listEmailSenders, listEmailTestSends, type EmailSendingStatus } from '@/lib/domain/email/sender';
import { emailSetupStep, listSendingDomains, type EmailSetupStep, type SendingDomain } from '@/lib/domain/email/sending-domains';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Email sending: the one place a business sets up email that goes out in its own name.
 *
 * It follows the order setup must happen in — a domain registered, its DNS published and
 * verified, a sender address at it, that address made the default, a test sent — and shows only
 * what the current step needs: sender addresses appear once a domain is verified (or one already
 * exists), and replies and the test once there is a default sender. Every state is the same answer a
 * send would get (`app.organization_email_sender`). Provider accounts and credentials are GildOps'
 * own and appear nowhere here. Which addresses receive into Conversations stays with
 * Communications (Incoming email).
 */
export default async function EmailSendingSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/email'>) {
  const { organizationId } = await params;
  // Organization configuration: the target's own `organization.manage` gate refuses anyone else.
  const { db } = await requireConfigurationTarget(organizationId, 'email');

  const [status, senders, domains, zones, tests] = await Promise.all([
    emailSendingStatus(db, organizationId),
    listEmailSenders(db, organizationId),
    listSendingDomains(db, organizationId),
    listConnectedDnsZones(db, organizationId),
    listEmailTestSends(db, organizationId),
  ]);
  const step = emailSetupStep({
    sendingState: status.state,
    domains,
    readySenders: senders.filter((sender) => sender.state === 'ready').length,
    testsSent: tests.length,
  });
  const verifiedDomain = domains.some((domain) => domain.state === 'ready');
  const hasDefault = status.state !== 'missing';

  return (
    <SettingsPageFrame>
      <SettingsPageHeader title="Email sending" />

      <NextStep step={step} status={status} domains={domains} />

      <SendingDomains
        organizationId={organizationId}
        domains={domains}
        automatedZone={(domain) => zones.find((zone) => isDnsAutomated(domain, [zone])) ?? null}
      />

      {verifiedDomain || senders.length > 0 ? (
        <SenderAddresses
          organizationId={organizationId}
          senders={senders}
          domains={domains.map((domain) => ({ resourceId: domain.resourceId, domain: domain.domain, ready: domain.state === 'ready' }))}
        />
      ) : null}

      {hasDefault ? <ReplyToForm organizationId={organizationId} senders={senders} hasDefault /> : null}
      {hasDefault || tests.length > 0 ? <TestSendForm organizationId={organizationId} ready={status.state === 'ready'} tests={tests} /> : null}

      <Hint className="mt-6">
        Which addresses receive replies into Conversations is set in{' '}
        <Link className="text-accent-text underline" href={`/organizations/${organizationId}/comms/configuration/email`}>Communications → Incoming email</Link>.
      </Hint>
    </SettingsPageFrame>
  );
}

/** Where this business stands, and the one thing to do next. */
function NextStep({ step, status, domains }: { step: EmailSetupStep; status: EmailSendingStatus; domains: SendingDomain[] }) {
  const pending = domains.find((domain) => domain.state === 'pending');
  const verified = domains.find((domain) => domain.state === 'ready');
  const [heading, sentence, warning] = ((): [string, string, boolean] => {
    switch (step) {
      case 'add_domain':
        return ['Not set up yet', 'Booking confirmations and automation emails are not sent until a domain is verified. Add the domain you will send from.', false];
      case 'verify_domain':
        return [
          pending ? `Verify ${pending.domain}` : 'Verify a domain',
          'Publish its DNS records, then check verification. Sender addresses can be added once it is verified.',
          false,
        ];
      case 'add_sender':
        return ['Add a sender address', `${verified?.domain ?? 'Your domain'} is verified. Add the address your business sends from.`, false];
      case 'choose_default':
        return ['Choose a default sender', 'Make a ready address the default so confirmations and messages can be sent.', false];
      case 'default_not_ready':
        return ['Default sender not ready', `${status.state === 'not_ready' ? status.address : ''} cannot send yet. ${status.state === 'not_ready' ? status.detail ?? '' : ''}`, true];
      case 'unavailable':
        return ['Sending paused by GildOps', `${status.state === 'unavailable' ? status.detail ?? '' : ''} This is on GildOps’ side; you do not need to change anything.`, false];
      case 'send_test':
        return ['Ready to send', `Email from your business is sent from ${status.state === 'ready' ? status.address : ''}. Send a test to see it arrive.`, false];
      case 'ready':
        return ['Ready to send', `Email from your business is sent from ${status.state === 'ready' ? status.address : ''}.`, false];
    }
  })();
  return (
    <CardSection title={heading} headingId="email-sending-status" className="mt-6">
      <p role="status" className={warning ? 'mt-1 text-sm text-danger' : 'mt-1 text-sm'}>{sentence}</p>
    </CardSection>
  );
}
