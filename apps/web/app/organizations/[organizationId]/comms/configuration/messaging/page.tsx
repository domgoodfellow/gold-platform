import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { ChannelReadiness } from '@/features/communications/channel-diagnostics';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { ButtonLink } from '@/components/controls/button';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { configTarget } from '@/lib/navigation';
import { CommunicationProfileForm } from '@/features/communications/communication-profile-form';
import { siteEditorState } from '@/lib/domain/public-site/public-site';
import type { Db } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

/** Messaging setup uses the canonical sender-readiness calculation and shared visitor profile. */
export default async function CommunicationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/configuration/messaging'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'communications');
  const channels = await messagingSenders(db, { organizationId });
  const mayManageWebsite = organization.capabilities.includes('organization.manage');

  const site = mayManageWebsite ? await siteEditorState(db as Db, organizationId) : null;
  const profileResult = site
    ? await (db.rpc.bind(db) as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)('public_communication_profile', { p_site_id: site.siteId })
    : null;
  const profileValue = profileResult?.data as { displayName?: string; greeting?: string; instructions?: string; handoffMessage?: string } | null;

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Messaging"
        crumbs={[
          ...workspaceConfigCrumbs(organizationId, 'communications', gate),
        ]}
      />
      <ChannelReadiness gate={gate} organizationId={organizationId} diagnostics={channels.diagnostics} maySend={organization.capabilities.includes('message.send')} channel="sms" />
      <Hint className="mt-1">
        The phone GildOps runs for this business, and how its website answers a visitor. Never
        what any of it costs GildOps, and never a secret. Apps a business connects itself are
        under Integrations.
      </Hint>

      <Section className="mt-8"><SectionHeading>Numbers & assignments</SectionHeading><ButtonLink href={`/organizations/${organizationId}/comms/configuration/numbers`} tone="text">Manage numbers & assignments</ButtonLink></Section>

      <Section className="mt-8">
        <SectionHeading>Email</SectionHeading>
        <ButtonLink
          href={`/organizations/${organizationId}/${configTarget('email').path}`}
          tone="text"
          size="small"
          className="mt-2 w-fit"
        >
          Open Email settings &rarr;
        </ButtonLink>
      </Section>

      {site ? (
        <CommunicationProfileForm
          organizationId={organizationId}
          siteId={site.siteId}
          initial={{
            enabled: Boolean(profileValue),
            displayName: profileValue?.displayName ?? 'Assistant',
            greeting: profileValue?.greeting ?? 'Hi — how can I help?',
            instructions: profileValue?.instructions ?? '',
            handoffMessage: profileValue?.handoffMessage ?? 'Thanks — a member of our team will follow up.',
            handoffDestination: '',
          }}
        />
      ) : null}
    </SettingsPageFrame>
  );
}
