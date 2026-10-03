import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { AddSendingDomainForm } from '@/features/communications/email/add-sending-domain-form';
import { SendingDomains } from '@/features/communications/email/sending-domains';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { isDnsAutomated, listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { listSendingDomains, MANAGED_SENDING } from '@/lib/domain/email/sending-domains';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

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
export default async function EmailSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/email'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');

  const [domains, zones] = await Promise.all([
    mayManage ? listSendingDomains(db, organizationId) : Promise.resolve([]),
    mayManage ? listConnectedDnsZones(db, organizationId) : Promise.resolve([]),
  ]);

  const header = (
    <PageHeader
      title="Email"
      crumbs={[
        { label: 'Settings', href: settingsLandingHref(organizationId) },
        { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
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
      <Hint className="mt-1">
        Proving a domain lets this business send email from addresses at it. It does not create a
        mailbox, and nothing sent to an address at this domain reaches GildOps.
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
    </SettingsPageFrame>
  );
}
