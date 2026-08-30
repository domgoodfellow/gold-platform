import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { requireOrganization } from '@/lib/route/organization';
import { CreatePriceItemForm, EditPriceItemForm } from './price-forms';

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  params,
}: PageProps<'/organizations/[organizationId]/pricing'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const items = await listPriceBookItems(db, { organizationId });
  const mayManage = organization.capabilities.includes('price.manage');

  // An item priced before this business changed what it trades in. Nothing converts it and
  // nothing reinterprets it — the amount means what it said when it was written (I8) — so the
  // only honest thing to do is say so and let somebody decide what it should be now.
  const stale = items.filter((item) => item.currency !== organization.currency);

  return (
    <>
      <p className="mt-1 text-sm opacity-70">
        What this business charges for. Nothing here is quoted until it is put on a job, and
        re-pricing an item never changes a job that already exists.
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          Nothing priced yet. What you sell and what you call it are yours — the platform
          ships no catalogue.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {items.map((item) => (
            <li key={item.id}>
              {mayManage ? (
                <EditPriceItemForm organizationId={organizationId} item={item} />
              ) : (
                <div className="py-3">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm opacity-70">
                    {formatMoney(item.unitAmountMinor, item.currency)} per {item.unit}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {stale.length > 0 ? (
        <p className="mt-4 text-sm opacity-70">
          {stale.length === 1 ? 'One item is' : `${stale.length} items are`} priced in a
          currency this business no longer trades in. Their amounts were not converted, because
          converting one would be inventing an exchange rate nobody recorded.
        </p>
      ) : null}

      {/*
        Hiding the form is a courtesy, not the guard. `price_book_items_insert` requires
        price.manage in the database, so a caller reaching the action anyway is refused there
        (constraints.md: hiding a UI element is not authorization).
      */}
      {mayManage ? (
        <CreatePriceItemForm organizationId={organizationId} currency={organization.currency} />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot set prices here.
        </p>
      )}
    </>
  );
}
