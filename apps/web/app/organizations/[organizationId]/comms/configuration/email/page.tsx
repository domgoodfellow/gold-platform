import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { ChannelReadiness } from '@/features/communications/channel-diagnostics';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { AddSendingDomainForm } from '@/features/communications/email/add-sending-domain-form';
import { EmailAddresses } from '@/features/communications/email/email-addresses';
import { SendingDomains } from '@/features/communications/email/sending-domains';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { isDnsAutomated, listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { listEmailIdentities } from '@/lib/domain/email/identities';
import { listSendingDomains, MANAGED_SENDING } from '@/lib/domain/email/sending-domains';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Whether this business can send email as itself, and what is still in the way.
 *
 * **A configuration screen, not an inbox.** Nothing here composes, sends or reads a message. What
 * it settles is narrower and has to come first: that the email provider will authorize mail from
 * addresses at a domain this business owns. Mailboxes, sender identities and the Communications
 * email product are each a different thing and a later slice.
 *
 * **Every state on this page is read from a row a provider's own answer wrote.** `Verified` means
 * the provider says so; it never means a form was submitted, and it never means DNS was written
 * — publishing a record and the provider accepting it are two facts, and only the second one
 * reaches `last_verified_at`.
 */
export default async function EmailSettingsPage({ params }: PageProps<'/organizations/[organizationId]/comms/configuration/email'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'email');
  const channels = await messagingSenders(db, { organizationId });
  const mayManage = organization.capabilities.includes('organization.manage');

  const [domains, zones, identities] = await Promise.all([
    mayManage ? listSendingDomains(db, organizationId) : Promise.resolve([]),
    mayManage ? listConnectedDnsZones(db, organizationId) : Promise.resolve([]),
    mayManage ? listEmailIdentities(db, { organizationId }) : Promise.resolve([]),
  ]);

  const header = (
    <PageHeader
      title="Email"
      crumbs={[
        ...workspaceConfigCrumbs(organizationId, 'email', gate),
      ]}
    />
  );

  if (!mayManage) {
    return (
      <SettingsPageFrame>
        {header}
        <Hint className="mt-5">
          Your role, {organization.role}, cannot configure the domain this business sends email from.
        </Hint>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame>
      {header}
      <ChannelReadiness gate={gate} organizationId={organizationId} diagnostics={channels.diagnostics} maySend={organization.capabilities.includes('message.send')} channel="email" />
      <Hint className="mt-1">
        Proving a domain lets this business send email from addresses at it. It does not create an
        address or a mailbox: an address is named below, beneath a domain that is verified.
      </Hint>

      <Section className="mt-8">
        <SectionHeading>{MANAGED_SENDING.heading}</SectionHeading>
        <Hint className="mt-1">{MANAGED_SENDING.state}</Hint>
        <p className="mt-2 max-w-prose text-sm text-subtle">{MANAGED_SENDING.detail}</p>
      </Section>

      <Section className="mt-8">
        <SectionHeading>Add a sending domain</SectionHeading>
        <Hint className="mt-1">
          You will need to add a few records at the company that manages DNS for the domain. If
          that is an account this business has connected, GildOps can publish them for you after
          you have read them.
        </Hint>
        <AddSendingDomainForm organizationId={organizationId} />
      </Section>

      <SendingDomains
        organizationId={organizationId}
        domains={domains}
        automatedZone={(domain) => zones.find((zone) => isDnsAutomated(domain, [zone])) ?? null}
      />

      <EmailAddresses
        organizationId={organizationId}
        identities={identities}
        domains={domains.map((domain) => ({ resourceId: domain.resourceId, domain: domain.domain, ready: domain.state === 'ready' }))}
      />
    </SettingsPageFrame>
  );
}
