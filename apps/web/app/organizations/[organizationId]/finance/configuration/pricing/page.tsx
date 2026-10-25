import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import Link from 'next/link';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { PaymentAccountRow } from '@/features/pricing/payment-account-row';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';

export const dynamic = 'force-dynamic';

/**
 * Finance configuration: what this business trades in and how it collects payment from its own
 * customers. The price book is an operating page (Catalog & Pricing); this address kept its
 * `#getting-paid` section so existing links still land on payment collection. What the business
 * pays GildOps is Settings → Plan & usage, never here.
 */
export default async function PaymentsAndCurrencyPage({ params }: PageProps<'/organizations/[organizationId]/finance/configuration/pricing'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'pricing');
  const provider = await paymentProvider();
  const [items, paymentAccount] = await Promise.all([
    listPriceBookItems(db, { organizationId }),
    provider ? getPaymentAccount(db, { organizationId, provider: provider.name }) : null,
  ]);
  const enabled = gate.featureAvailability.has('card_payments');
  const mayManagePayments = organization.capabilities.includes('organization.manage');
  return <SettingsPageFrame>
    <PageHeader title="Payments & currency" crumbs={[...workspaceConfigCrumbs(organizationId, 'pricing', gate),]} />
    <Hint>Services and their prices are in <Link href={`/organizations/${organizationId}/finance/catalog`} className="text-accent-text hover:underline">Catalog & Pricing</Link>.</Hint>
    <Section id="currency"><SectionHeading>Trading currency</SectionHeading><Hint className="mt-2">{organization.currency ?? 'No currency configured. Choose a currency before adding prices.'}</Hint>
      <Link href={`/organizations/${organizationId}/settings/general#address-heading`} className="mt-2 inline-block text-sm text-accent-text hover:underline">Organization currency settings</Link>
      {items.some(i => i.currency !== organization.currency) ? <Hint className="mt-2">Historical catalogue currencies remain unchanged. Amounts are never converted without a recorded rate.</Hint> : null}
    </Section>
    <Section id="getting-paid"><SectionHeading>Payment collection</SectionHeading><Hint className="mt-2">Payments can always be recorded by hand by people with payment permission. A business that does not take cards needs nothing else here.</Hint>
      {!enabled ? <Hint className="mt-2">Card payments are not enabled for this organization.</Hint> : provider ? <PaymentAccountRow organizationId={organizationId} provider={provider.name} accountId={paymentAccount?.account.accountId ?? null} connectedAt={paymentAccount?.connectedAt ?? null} mayManage={mayManagePayments} /> : <Hint className="mt-2">Processor unavailable. This deployment has no payment processor configured.</Hint>}
      <Link href={`/organizations/${organizationId}/settings/features`} className="mt-3 inline-block text-sm text-accent-text hover:underline">{organization.capabilities.includes('feature.manage') ? 'Manage payment features' : 'View available payment features'}</Link>
    </Section>
  </SettingsPageFrame>;
}
