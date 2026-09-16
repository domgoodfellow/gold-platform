import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Disclosure } from '@/components/containers/card';
import { DataTable } from '@/components/display/table';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { listModuleSettings } from '@/lib/domain/tenancy/modules';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireOrganization } from '@/lib/route/organization';
import { ChooseCurrencyForm, CreatePriceItemForm, EditPriceItemForm } from './price-forms';
import { PaymentAccountRow } from './payment-account-row';

export const dynamic = 'force-dynamic';

/**
 * "What do we sell, what do we charge, and how do our customers pay us?" — the
 * BUSINESS → CUSTOMER commercial plane. Getting paid lives on the same page as the price book it
 * charges through, reached at `#getting-paid` when card payments is switched on.
 */
export default async function PricingPage({
  params,
}: PageProps<'/organizations/[organizationId]/pricing'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const provider = await paymentProvider();
  const [items, modules, paymentAccount] = await Promise.all([
    listPriceBookItems(db, { organizationId }),
    listModuleSettings(db, { organizationId }),
    provider ? getPaymentAccount(db, { organizationId, provider: provider.name }) : null,
  ]);
  const enabled = new Set(
    modules.filter((entry) => entry.enabledAt !== null).map((entry) => entry.module.key),
  );
  const mayManage = organization.capabilities.includes('price.manage');
  const mayManagePayments = organization.capabilities.includes('organization.manage');
  const currency = organization.currency;
  const stale = items.filter((item) => item.currency !== organization.currency);

  return (
    <>
      <Hint>What this business sells, and how it collects payment.</Hint>

      <Section className="mt-6">
        <SectionHeading>Services &amp; pricing</SectionHeading>
        <Hint className="mt-1">
          What this business charges for. Nothing here is quoted until it is put on a job, and
          re-pricing an item never changes a job that already exists.
        </Hint>

        {items.length === 0 ? (
          currency === null ? null : (
            <EmptyState className="mt-4">
              Nothing priced yet. What you sell and what you call it are yours — the platform
              ships no catalogue.
            </EmptyState>
          )
        ) : mayManage ? (
          <DividedList className="mt-4">
            {items.map((item) => (
              <li key={item.id}>
                <EditPriceItemForm organizationId={organizationId} item={item} />
              </li>
            ))}
          </DividedList>
        ) : (
          <div className="mt-4">
            <DataTable
              rows={items}
              rowKey={(item) => item.id}
              empty="Nothing priced yet."
              columns={[
                { key: 'name', header: 'What', emphasis: 'primary', cell: (item) => item.name },
                { key: 'unit', header: 'Per', cell: (item) => item.unit },
                {
                  key: 'amount',
                  header: 'Price',
                  numeric: true,
                  cell: (item) => formatMoney(item.unitAmountMinor, item.currency),
                },
              ]}
            />
          </div>
        )}

        {stale.length > 0 ? (
          <Hint className="mt-4">
            {stale.length === 1 ? 'One item is' : `${stale.length} items are`} priced in a
            currency this business no longer trades in. Their amounts were not converted, because
            converting one would be inventing an exchange rate nobody recorded.
          </Hint>
        ) : null}

        {!mayManage ? (
          <Hint className="mt-6">Your role, {organization.role}, cannot set prices here.</Hint>
        ) : currency === null ? (
          organization.capabilities.includes('organization.manage') ? (
            <ChooseCurrencyForm organizationId={organizationId} />
          ) : (
            <Hint className="mt-6 max-w-prose">
              Before anything can be priced, this business has to say what it charges in. Your
              role, {organization.role}, cannot answer that — somebody who manages this
              business&rsquo;s settings can, and then prices can go in here.
            </Hint>
          )
        ) : (
          <Disclosure summary="Add something to the price book" defaultOpen={items.length === 0} className="mt-4">
            <CreatePriceItemForm organizationId={organizationId} currency={currency} />
          </Disclosure>
        )}
      </Section>

      {enabled.has('card_payments') ? (
        <Section id="getting-paid" className="mt-10 scroll-mt-6">
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
                mayManage={mayManagePayments}
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
    </>
  );
}
