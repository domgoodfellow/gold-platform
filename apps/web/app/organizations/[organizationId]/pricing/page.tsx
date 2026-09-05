import { DividedList, EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOrganization } from '@/lib/route/organization';
import { Disclosure } from '@/components/containers/card';
import { DataTable } from '@/components/display/table';
import { ChooseCurrencyForm, CreatePriceItemForm, EditPriceItemForm } from './price-forms';

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  params,
}: PageProps<'/organizations/[organizationId]/pricing'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const items = await listPriceBookItems(db, { organizationId });
  const mayManage = organization.capabilities.includes('price.manage');

  // **This business has not said what it trades in, and this is where it is asked.** Signing up
  // does not ask (`20260904000001`): a currency is a fact about money, and the first screen a
  // person meets is not about money. Here it is — they are looking at a price book — so the
  // question is asked once, in context, by somebody already thinking about the answer.
  const currency = organization.currency;

  // An item priced before this business changed what it trades in. Nothing converts it and
  // nothing reinterprets it — the amount means what it said when it was written (I8) — so the
  // only honest thing to do is say so and let somebody decide what it should be now.
  const stale = items.filter((item) => item.currency !== organization.currency);

  return (
    <>
      <Hint className="mt-1">
        What this business charges for. Nothing here is quoted until it is put on a job, and
        re-pricing an item never changes a job that already exists.
      </Hint>

      {items.length === 0 ? (
        // Silent while the currency question is on screen: two empty-state sentences stacked on
        // each other is how a page stops being read.
        currency === null ? null : (
          <EmptyState className="mt-6">
            Nothing priced yet. What you sell and what you call it are yours — the platform
            ships no catalogue.
          </EmptyState>
        )
      ) : mayManage ? (
        // **A price book somebody may edit is a list of forms, not a table**, and forcing it
        // into one would mean a row whose every cell is an input pretending to be a value.
        // What it gains from the pass is wrapping: each row already lays out with
        // `flex-wrap`, so on a phone the fields stack instead of overflowing.
        <DividedList className="mt-6">
          {items.map((item) => (
            <li key={item.id}>
              <EditPriceItemForm organizationId={organizationId} item={item} />
            </li>
          ))}
        </DividedList>
      ) : (
        <div className="mt-6">
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

      {/*
        Hiding the form is a courtesy, not the guard. `price_book_items_insert` requires
        price.manage in the database, so a caller reaching the action anyway is refused there
        (constraints.md: hiding a UI element is not authorization).
      */}
      {!mayManage ? (
        <Hint className="mt-8">
          Your role, {organization.role}, cannot set prices here.
        </Hint>
      ) : currency === null ? (
        // Saying what a business trades in is an `organization.manage` act and pricing is a
        // `price.manage` one, and they are plausibly two people. Somebody who may price but may
        // not answer this is told who can, rather than being shown a form that would be refused
        // — the same courtesy every other screen pays, and the database is still the guard.
        organization.capabilities.includes('organization.manage') ? (
          <ChooseCurrencyForm organizationId={organizationId} />
        ) : (
          <Hint className="mt-8 max-w-prose">
            Before anything can be priced, this business has to say what it charges in. Your
            role, {organization.role}, cannot answer that — somebody who manages this
            business’s settings can, and then prices can go in here.
          </Hint>
        )
      ) : (
        <Disclosure summary="Add something to the price book" defaultOpen={items.length === 0} className="mt-6">
          <CreatePriceItemForm organizationId={organizationId} currency={currency} />
        </Disclosure>
      )}
    </>
  );
}
