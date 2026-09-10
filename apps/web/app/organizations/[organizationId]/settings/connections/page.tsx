import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { listProviders } from '@/lib/domain/commercial/catalogue';
import { listProviderBindings, listProviderResources } from '@/lib/domain/providers/bindings';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { requireOrganization } from '@/lib/route/organization';
import { AddEmailDomainForm } from './forms';

export const dynamic = 'force-dynamic';

const RESEND_STATUS_WORD: Record<string, string> = {
  pending: 'Verification required',
  active: 'Verified',
  failed: 'Failed',
  disabled: 'Disabled',
};

/**
 * The service GOLD exposes to this business — never GOLD's vendor accounts.
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
export default async function ConnectionsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/connections'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [bindings, resources, providers, selectedNumber] = await Promise.all([
    listProviderBindings(db, { organizationId }),
    listProviderResources(db, { organizationId }),
    listProviders(db),
    callingNumber(db, { organizationId }),
  ]);

  const twilioBinding = bindings.find((row) => row.providerKey === 'twilio') ?? null;
  const providerLabel = new Map(providers.map((provider) => [provider.key, provider.label]));
  const numbers = resources.filter((resource) => resource.resourceType === 'twilio_phone_number');
  const domains = resources.filter((resource) => resource.resourceType === 'resend_domain');
  const speechProviders = providers.filter((provider) =>
    ['deepgram', 'elevenlabs', 'anthropic', 'openai_compatible'].includes(provider.key),
  );

  return (
    <>
      <PageHeading>Connections</PageHeading>
      <Hint className="mt-1">
        What this business is connected to, and what it can choose from. Never what any of it
        costs GOLD, and never a secret.
      </Hint>

      <Section className="mt-8">
        <SectionHeading>Phone</SectionHeading>
        {!twilioBinding || twilioBinding.status !== 'active' ? (
          <EmptyState className="mt-2">
            Not connected yet. GOLD sets this up — nothing to do here until it is.
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
          GOLD sends every automated message from one address until a domain of your own is
          verified beneath it.
        </Hint>
        {domains.length === 0 ? (
          <EmptyState className="mt-2">No sending domain configured.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {domains.map((domain) => (
              <div key={domain.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="font-medium">{domain.externalId}</span>
                <span className="text-subtle">{RESEND_STATUS_WORD[domain.status] ?? domain.status}</span>
              </div>
            ))}
          </DividedList>
        )}
        <AddEmailDomainForm organizationId={organizationId} />
      </Section>

      <Section className="mt-8">
        <SectionHeading>AI &amp; speech</SectionHeading>
        <Hint className="mt-1">
          What this deployment can call on. There is no business decision here yet — which model
          or speech provider answers is this deployment&rsquo;s own configuration, not this
          business&rsquo;s.
        </Hint>
        {speechProviders.length === 0 ? (
          <EmptyState className="mt-2">Nothing available on this deployment.</EmptyState>
        ) : (
          <DividedList as="div" className="mt-2">
            {speechProviders.map((provider) => (
              <div key={provider.key} className="py-2 text-sm">
                {providerLabel.get(provider.key) ?? provider.label}
              </div>
            ))}
          </DividedList>
        )}
      </Section>
    </>
  );
}
