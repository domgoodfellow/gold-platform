import Link from 'next/link';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { ChannelReadiness } from '@/features/communications/channel-diagnostics';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { EmailAddresses } from '@/features/communications/email/email-addresses';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listEmailIdentities } from '@/lib/domain/email/identities';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Inbox email: how this business's addresses behave in the Communications Inbox — which of them
 * receive replies here, and whether the Inbox can send email at all.
 *
 * **Not where email sending is set up.** Domains, sender addresses and the default sender are
 * organization-wide (Settings → Email sending), because automations and service notifications
 * send from them too. This page links there instead of repeating it.
 */
export default async function InboxEmailPage({ params }: PageProps<'/organizations/[organizationId]/comms/configuration/email'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'inbox-email');
  const [channels, identities] = await Promise.all([
    messagingSenders(db, { organizationId }),
    listEmailIdentities(db, { organizationId }),
  ]);

  return (
    <SettingsPageFrame>
      <PageHeader title="Inbox email" crumbs={[...workspaceConfigCrumbs(organizationId, 'inbox-email', gate)]} />
      <Hint className="mt-1 max-w-prose">
        Domains, sender addresses and the default sender are set up in{' '}
        <Link className="text-accent-text underline" href={`/organizations/${organizationId}/settings/email`}>Settings → Email sending</Link>.
        Here you choose which of those addresses receive replies into the Inbox.
      </Hint>
      <div className="mt-6">
        <ChannelReadiness gate={gate} organizationId={organizationId} diagnostics={channels.diagnostics} maySend={organization.capabilities.includes('message.send')} channel="email" />
      </div>
      <EmailAddresses organizationId={organizationId} identities={identities} domains={[]} allowAdding={false} />
    </SettingsPageFrame>
  );
}
