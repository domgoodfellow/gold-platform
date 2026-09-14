import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Disclosure } from '@/components/containers/card';
import { DataTable } from '@/components/display/table';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireOrganization } from '@/lib/route/organization';
import { ChooseCurrencyForm, CreatePriceItemForm, EditPriceItemForm } from '../../pricing/price-forms';

export const dynamic = 'force-dynamic';

/**
 * "What do we sell, what do we charge, and how do our customers pay us?" — the
 * BUSINESS → CUSTOMER commercial plane, deliberately separate from Plan & usage (the GOLD →
 * ORGANIZATION plane, under the GOLD Account group in the Settings navigation).
 *
 * Services & pricing reuses `/pricing`'s own components unchanged (that route now redirects
 * here). Payment collection — connecting a processor account — remains for this slice on the
 * Settings root page's "Getting paid" section, reachable from the link below: moving it
 * requires `MODULES`'s `card_payments.configuredAt` to point at a segment `navigation.ts`'s
 * `AREAS` recognises, which duplicating here without also updating that registry and its test
 * would leave two competing sections claiming to be where the module is configured (D31).
 */
export default async function CommerceSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/commerce'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const items = await listPriceBookItems(db, { organizationId });
  const mayManage = organization.capabilities.includes('price.manage');
  const currency = organization.currency;
  const stale = items.filter((item) => item.currency !== organization.currency);

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Business commerce</PageHeading>
      <Hint className="mt-1">What this business sells, and how it collects payment.</Hint>

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

      <Section className="mt-10">
        <SectionHeading>Payment collection</SectionHeading>
        <Hint className="mt-1">
          Connecting a payment processor is configured on the{' '}
          <a href={`/organizations/${organizationId}/settings#getting-paid`} className="underline underline-offset-4">
            Settings
          </a>{' '}
          page for now, alongside this business&rsquo;s public page.
        </Hint>
      </Section>
    </SettingsPageFrame>
  );
}
