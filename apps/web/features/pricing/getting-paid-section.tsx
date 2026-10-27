import Link from 'next/link';
import { Card } from '@/components/surfaces/card';
import { SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { PaymentAccountRow } from './payment-account-row';

const OUTCOME: Record<string, { text: string; alert?: boolean }> = {
  connected: { text: 'Payment account connected.' },
  cancelled: { text: 'Connecting was cancelled. Nothing changed.' },
  mismatch: { text: 'That connection could not be confirmed, so nothing was connected. Try again from here.', alert: true },
  failed: { text: 'The payment processor did not complete the connection, so nothing was connected. Try again.', alert: true },
};

/**
 * How this business gets paid by its own customers (Organization Settings → Customer payments): the
 * trading currency it collects in (read here, edited only in General), that payments are always
 * recordable by hand, and, when card payments are on, the processor account. Customer money settles
 * to this business's own account (ADR-037); what the business pays GildOps is Plan & usage, never here.
 */
export async function GettingPaidSection({ organizationId, outcome }: { organizationId: string; outcome?: string }) {
  const { db, organization } = await requireOrganization(organizationId);
  const features = availableFeatureKeys(await organizationResolvedFeatureStates(db, { organizationId }));
  const cards = features.has('card_payments');
  const provider = cards ? await paymentProvider() : null;
  const account = provider ? await getPaymentAccount(db, { organizationId, provider: provider.name }) : null;
  const link = 'text-accent-text hover:underline';
  const result = outcome ? OUTCOME[outcome] : undefined;
  return <div className="flex flex-col gap-6">
    {result ? <p role={result.alert ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${result.alert ? 'border-danger/40 text-danger' : 'border-border'}`}>{result.text}</p> : null}

    <Card as="section" aria-labelledby="payments-currency-heading">
      <div className="flex flex-col gap-2">
        <SectionHeading id="payments-currency-heading">Trading currency</SectionHeading>
        <p className="text-sm">
          {organization.currency
            ? <>New prices and invoices are in <strong className="font-medium">{organization.currency}</strong>. Amounts already recorded keep their currency.</>
            : <>No trading currency is chosen yet, so nothing can be priced.</>}
        </p>
        <Link href={`/organizations/${organizationId}/settings/general#regional-heading`} className={`w-fit text-sm ${link}`}>Change in General → Regional settings</Link>
      </div>
    </Card>

    <Card as="section" aria-labelledby="payments-manual-heading">
      <div className="flex flex-col gap-2">
        <SectionHeading id="payments-manual-heading">Recording payments</SectionHeading>
        <Hint>People with payment permission can always record a payment by hand against an invoice in Finance. A business that does not take cards needs nothing else here.</Hint>
      </div>
    </Card>

    <Card as="section" id="getting-paid" aria-labelledby="payments-card-heading">
      <div className="flex flex-col gap-2">
        <SectionHeading id="payments-card-heading">Card payments</SectionHeading>
        {!cards ? <Hint>Card payments are not switched on for this business.</Hint>
          : provider ? <PaymentAccountRow organizationId={organizationId} provider={provider.name} accountId={account?.account.accountId ?? null} connectedAt={account?.connectedAt ?? null} mayManage={organization.capabilities.includes('organization.manage')} />
          : <Hint>Card payments are switched on, but this installation has no payment processor.</Hint>}
        <Link href={`/organizations/${organizationId}/settings/features`} className={`w-fit text-sm ${link}`}>{organization.capabilities.includes('feature.manage') ? 'Manage payment features' : 'View available payment features'}</Link>
      </div>
    </Card>

    <p className="text-xs text-muted">
      This is how your customers pay you. What this business pays GildOps is {organization.capabilities.includes('billing.manage')
        ? <Link href={`/organizations/${organizationId}/settings/plan`} className={link}>Plan &amp; usage</Link>
        : 'Plan & usage'}.
    </p>
  </div>;
}
