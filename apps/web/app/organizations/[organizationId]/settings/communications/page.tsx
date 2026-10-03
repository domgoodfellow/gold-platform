import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { ButtonLink } from '@/components/controls/button';
import { listProviderBindings, listProviderResources } from '@/lib/domain/providers/bindings';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { configTarget } from '@/lib/navigation';
import { CommunicationProfileForm } from '@/features/communications/communication-profile-form';
import { homepageEditorState } from '@/lib/domain/public-site/public-site';
import type { Db } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

/**
 * The communication services GOLD runs for this business — never GOLD's vendor accounts, and
 * never a choice of wholesale model or speech vendor: a business configures what it wants done
 * (call transcription, AI quality) once those exist, not which vendor GOLD calls to do it.
 *
 *
 * **What is deliberately absent.** No parent provider account, no API secret, no Vault
 * reference, no wholesale provider rate, no provider cost, no provider billing data
 * (`constraints.md` D43, extended by this slice). Every read below either selects columns that
 * already withhold a secret at the grant (`organization_provider_resources.secret_id` is in no
 * grant to `authenticated`) or reads a table with nothing sensitive in it at all.
 *
 * **One configuration path, not two.** Choosing an outbound number is still done from Calls,
 * where `CallingNumberForm` already lives (D25: a switch leads to its inputs, once, not twice).
 * This page shows what is bound and which one is chosen; changing which one is chosen happens
 * there.
 */
export default async function CommunicationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/communications'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManageWebsite = organization.capabilities.includes('organization.manage');

  const [bindings, resources, selectedNumber, site] = await Promise.all([
    listProviderBindings(db, { organizationId }),
    listProviderResources(db, { organizationId }),
    callingNumber(db, { organizationId }),
    mayManageWebsite ? homepageEditorState(db as Db, organizationId) : Promise.resolve(null),
  ]);
  const profileResult = site
    ? await (db.rpc.bind(db) as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)('public_communication_profile', { p_site_id: site.siteId })
    : null;
  const profileValue = profileResult?.data as { displayName?: string; greeting?: string; instructions?: string; handoffMessage?: string } | null;

  const twilioBinding = bindings.find((row) => row.providerKey === 'twilio') ?? null;
  const numbers = resources.filter((resource) => resource.resourceType === 'twilio_phone_number');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Communications"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
      />
      <Hint className="mt-1">
        The phone GildOps runs for this business, and how its website answers a visitor. Never
        what any of it costs GildOps, and never a secret. Apps a business connects itself are
        under Integrations.
      </Hint>

      <Section className="mt-8">
        <SectionHeading>Phone</SectionHeading>
        {!twilioBinding || twilioBinding.status !== 'active' ? (
          <EmptyState className="mt-2">
            Not connected yet. GildOps sets this up — nothing to do here until it is.
          </EmptyState>
        ) : (
          <>
            <Hint className="mt-1">
              {numbers.length === 0
                ? 'Connected, with no number of your own yet.'
                : `Connected. ${numbers.length} number${numbers.length === 1 ? '' : 's'} available.`}
            </Hint>
            {numbers.length > 0 ? (
              <DividedList as="div" className="mt-2">
                {numbers.map((number) => (
                  <div key={number.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                    <span className="font-medium">{number.externalId}</span>
                    <span className="text-subtle">
                      {number.externalId === selectedNumber ? 'outbound identity' : number.status}
                    </span>
                  </div>
                ))}
              </DividedList>
            ) : null}
            <ButtonLink href={`/organizations/${organizationId}/calls`} tone="text" size="small" className="mt-2 w-fit">
              Choose which one to dial from →
            </ButtonLink>
          </>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Email</SectionHeading>
        <Hint className="mt-1">
          The domain this business sends email from, and what it still needs to be verified, is
          configured on its own page.
        </Hint>
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
