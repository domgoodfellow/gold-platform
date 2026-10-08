import Link from 'next/link';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { Disclosure } from '@/components/surfaces/card';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listModuleSettings } from '@/lib/domain/tenancy/modules';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';
import { ChooseCurrencyForm } from '@/features/pricing/price-forms';
import { PricingManagement } from '@/features/pricing/pricing-management';
import { PaymentAccountRow } from '@/features/pricing/payment-account-row';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';

export const dynamic = 'force-dynamic';
export default async function PricingPage({ params }: PageProps<'/organizations/[organizationId]/settings/pricing'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const provider = await paymentProvider();
  const [items, modules, paymentAccount] = await Promise.all([
    listPriceBookItems(db, { organizationId }), listModuleSettings(db, { organizationId }),
    provider ? getPaymentAccount(db, { organizationId, provider: provider.name }) : null,
  ]);
  const enabled = modules.some(m => m.module.key === 'card_payments' && m.enabledAt !== null);
  const mayManage = organization.capabilities.includes('price.manage');
  const mayManagePayments = organization.capabilities.includes('organization.manage');
  return <SettingsPageFrame>
    <PageHeader title="Services & Pricing" crumbs={[{label:'Settings',href:settingsLandingHref(organizationId)},{label:'Organization',href:settingsScopeHref('organization',organizationId)}]} />
    <Link href={`/organizations/${organizationId}/finance`} className="text-sm text-primary hover:underline">Back to Finance</Link>
    <Section><Hint>Manage what your business charges. Existing quotes and issued invoices keep their original prices.</Hint>
      <PricingManagement organizationId={organizationId} items={items} currency={organization.currency} mayManage={mayManage} />
      {!mayManage ? <Hint className="mt-3">Your role can view the price book but cannot change prices.</Hint> : null}
    </Section>
    <Section id="currency"><SectionHeading>Trading currency</SectionHeading><Hint className="mt-2">{organization.currency ?? 'No currency configured. Choose a currency before adding prices.'}</Hint>
      {mayManagePayments ? <Disclosure summary={organization.currency ? 'Change trading currency' : 'Set trading currency'} defaultOpen={!organization.currency}><ChooseCurrencyForm organizationId={organizationId} currentCurrency={organization.currency} /></Disclosure> : null}
      {items.some(i => i.currency !== organization.currency) ? <Hint className="mt-2">Historical catalogue currencies remain unchanged. Amounts are never converted without a recorded rate.</Hint> : null}
    </Section>
    <Section id="getting-paid"><SectionHeading>Payment configuration</SectionHeading><Hint className="mt-2">Manual payment recording remains available to people with payment permission.</Hint>
      {!enabled ? <Hint className="mt-2">Card payments are not enabled for this organization.</Hint> : provider ? <PaymentAccountRow organizationId={organizationId} provider={provider.name} accountId={paymentAccount?.account.accountId ?? null} connectedAt={paymentAccount?.connectedAt ?? null} mayManage={mayManagePayments} /> : <Hint className="mt-2">Processor unavailable. This deployment has no payment processor configured.</Hint>}
      <Link href={`/organizations/${organizationId}/settings/features`} className="mt-3 inline-block text-sm text-primary hover:underline">{organization.capabilities.includes('feature.manage') ? 'Manage payment features' : 'View available payment features'}</Link>
    </Section>
  </SettingsPageFrame>;
}
