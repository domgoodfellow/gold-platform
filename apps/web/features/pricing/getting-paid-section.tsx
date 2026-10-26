import Link from 'next/link';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { PaymentAccountRow } from './payment-account-row';

/**
 * How this business gets paid by its own customers (Organization Settings → General,
 * `#getting-paid`): the trading currency it collects in, edited only in the address section above,
 * that payments are always recordable by hand, and, when card payments are on, the processor
 * account. Customer money settles to this business's own account (ADR-037); what the business
 * pays GildOps is Plan & usage, never here.
 */
export async function GettingPaidSection({ organizationId, id }: { organizationId: string; id: string }) {
  const { db, organization } = await requireOrganization(organizationId);
  const features = availableFeatureKeys(await organizationResolvedFeatureStates(db, { organizationId }));
  const cards = features.has('card_payments');
  const provider = cards ? await paymentProvider() : null;
  const account = provider ? await getPaymentAccount(db, { organizationId, provider: provider.name }) : null;
  const link = 'text-accent-text hover:underline';
  return <Section id={id} className="mt-10">
    <SectionHeading>Getting paid</SectionHeading>
    <Hint className="mt-2">
      {organization.currency ? <>New prices and invoices are in <strong className="font-medium">{organization.currency}</strong>. </> : <>No trading currency is chosen yet, so nothing can be priced. </>}
      It is set with this business’s country and time zone in the <Link href={`/organizations/${organizationId}/settings/general#address-heading`} className={link}>address section</Link>; amounts already recorded keep their currency.
    </Hint>
    <Hint className="mt-2">Payments can always be recorded by hand in Finance by people with payment permission. A business that does not take cards needs nothing else here.</Hint>
    {!cards ? <Hint className="mt-2">Card payments are not switched on for this business.</Hint>
      : provider ? <PaymentAccountRow organizationId={organizationId} provider={provider.name} accountId={account?.account.accountId ?? null} connectedAt={account?.connectedAt ?? null} mayManage={organization.capabilities.includes('organization.manage')} />
      : <Hint className="mt-2">Card payments are switched on, but this installation has no payment processor.</Hint>}
    <Link href={`/organizations/${organizationId}/settings/features`} className={`mt-3 inline-block text-sm ${link}`}>{organization.capabilities.includes('feature.manage') ? 'Manage payment features' : 'View available payment features'}</Link>
  </Section>;
}
