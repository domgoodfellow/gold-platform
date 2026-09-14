import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/containers/section';
import { ProfileForm } from '@/features/public-profile/profile-form';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listModuleSettings } from '@/lib/domain/tenancy/modules';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { requireOrganization } from '@/lib/route/organization';
import { updateProfileAction } from './actions';
import { BrandForm, LogoForm } from './brand-forms';
import { PaymentAccountRow } from './settings-forms';

export const dynamic = 'force-dynamic';

/**
 * Public presence and getting paid — what a stranger sees before they book, and how this
 * business is paid for it. Everything else this page used to hold (business identity/regional
 * settings, opening hours, custom fields, people and roles, automations, pricing, modules,
 * plan & usage) now has its own place under the Settings navigation; see
 * `features/settings/settings-navigation.tsx`.
 *
 * **What is still here, deliberately, and why.** `MODULES`'s `booking` and `card_payments`
 * entries point their `configuredAt` at this exact segment and section id
 * (`#public-page`/`#getting-paid`), and `navigation.test.ts` asserts both by reading this file's
 * own source (D31: "a switch leads to its inputs"). Moving either section to its own route
 * requires that route to be a segment `navigation.ts`'s `AREAS` recognises — the same
 * top-level-route pattern `pricing`/`automations`/`fields`/`roles` already use — which is real,
 * separate work (updating `AREAS`, `MODULES.configuredAt`, and the corresponding assertions in
 * `navigation.test.ts` together, deliberately) rather than a side effect of this slice.
 */
export default async function SettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const provider = await paymentProvider();
  const [profile, modules, paymentAccount, brand, bookableTypes] = await Promise.all([
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    listModuleSettings(db, { organizationId }),
    provider ? getPaymentAccount(db, { organizationId, provider: provider.name }) : null,
    getBrand(db, { organizationId }),
    listBookableTypes(db, { organizationId }),
  ]);

  const enabled = new Set(
    modules.filter((entry) => entry.enabledAt !== null).map((entry) => entry.module.key),
  );
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <Hint className="mt-1">What customers see before they book, and how this business is paid.</Hint>

      <Section id="public-page" className="mt-6 scroll-mt-6">
        <SectionHeading>Public page</SectionHeading>
        <Hint className="mt-1">
          What customers see before they book. Everything here is this business&rsquo;s own
          words — the platform writes none of it, and a page left empty shows the business name
          and nothing else.
        </Hint>

        {mayManage ? (
          <ProfileForm
            organizationId={organizationId}
            profile={profile}
            slug={organization.slug}
            hasBookableType={bookableTypes.length > 0}
            action={updateProfileAction}
          />
        ) : (
          <Hint className="mt-4">
            Your role, {organization.role}, cannot change what this business says about itself.
          </Hint>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>How this business looks</SectionHeading>
        <Hint className="mt-1">
          Your colour, your lettering and your logo, on these screens and on any page your
          customers see. The page itself stays readable whatever you choose — a colour is used
          for buttons and links, and darkened automatically where it would be hard to read.
        </Hint>

        {mayManage ? (
          <>
            <BrandForm organizationId={organizationId} brand={brand} />
            <LogoForm
              organizationId={organizationId}
              logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
            />
          </>
        ) : (
          <Hint className="mt-4">
            Your role, {organization.role}, cannot change how this business looks.
          </Hint>
        )}
      </Section>

      {enabled.has('card_payments') ? (
        <Section id="getting-paid" className="mt-8 scroll-mt-6">
          <SectionHeading>Getting paid</SectionHeading>
          <Hint className="mt-1">
            Card payments go directly to this business. GOLD never holds the money, and this
            business keeps its own account with the payment provider.
          </Hint>
          {provider ? (
            <div className="mt-2 border-t border-border">
              <PaymentAccountRow
                organizationId={organizationId}
                provider={provider.name}
                accountId={paymentAccount?.account.accountId ?? null}
                connectedAt={paymentAccount?.connectedAt ?? null}
                mayManage={mayManage}
              />
            </div>
          ) : (
            <Hint className="mt-2">
              This deployment has no payment processor yet, so there is no account to connect.
              Nothing is wrong with this business&rsquo;s settings and there is nothing to do
              here until one is configured. Invoices still record cash and bank payments.
            </Hint>
          )}
        </Section>
      ) : null}

      <Section className="mt-8">
        <SectionHeading>Business setup</SectionHeading>
        <Hint className="mt-1">
          {organization.operationalState === 'setup'
            ? 'Describe this business, review readiness, and launch when ready.'
            : "Review or revise this business's configuration."}
        </Hint>
        <Link
          href={`/organizations/${organizationId}/setup`}
          className="mt-2 inline-block text-sm underline underline-offset-4"
        >
          Guided setup
        </Link>
      </Section>
    </SettingsPageFrame>
  );
}
