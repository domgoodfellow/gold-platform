'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { EmptyState } from '@/components/surfaces/section';
import { PriceItemRowForm } from './price-forms';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const ROW = 'grid gap-1 px-3 py-3 @min-[40rem]/prices:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @min-[40rem]/prices:items-center @min-[40rem]/prices:gap-2';

/**
 * The price book, edited where it is read. An item is a name, a unit and an amount in the currency
 * it was priced in, so adding or re-pricing one happens in its own row rather than in a drawer that
 * repeated the row beside it. One row is edited at a time: the other Edit buttons wait, so a change
 * is never abandoned by opening another. Saving is still one write per item through the existing
 * actions; items keep their name order, and there is no delete or archive to offer.
 */
export function PricingManagement({ organizationId, items, currency, mayManage }: { organizationId: string; items: PriceBookItem[]; currency: string | null; mayManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  // Focus goes back to the control that opened the row, once the row has closed and it is drawn again.
  const close = (key: string) => {
    setEditing(null);
    requestAnimationFrame(() => triggers.current.get(key)?.focus());
  };
  const mayAdd = mayManage && !!currency;

  return (
    <section aria-labelledby="price-book-heading" className="@container/prices mt-4 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <h2 id="price-book-heading" className="font-semibold">Price book <span className="text-sm font-normal text-muted">({items.length})</span></h2>
        {mayAdd ? <Button ref={(node) => { triggers.current.set('new', node); }} size="small" disabled={editing !== null} onClick={() => setEditing('new')}>Add price item</Button> : null}
      </div>
      {mayManage && !currency ? <Hint className="px-3 pb-3">Choose a trading currency before adding prices.</Hint> : null}
      {items.length || editing === 'new' ? (
        <>
          <div aria-hidden className={`${ROW} hidden border-y border-border text-xs font-medium text-muted @min-[40rem]/prices:grid`}><span>Name</span><span>Unit</span><span className="text-right">Price</span><span className="w-24" /></div>
          <ul className="divide-y divide-border">
            {editing === 'new' && currency ? <li><PriceItemRowForm organizationId={organizationId} currency={currency} onDone={() => close('new')} onCancel={() => close('new')} /></li> : null}
            {items.map((item) => editing === item.id ? (
              <li key={item.id}><PriceItemRowForm organizationId={organizationId} item={item} currency={item.currency} onDone={() => close(item.id)} onCancel={() => close(item.id)} /></li>
            ) : (
              <li key={item.id} className={ROW}>
                <span className="break-words font-medium">{item.name}</span>
                <span className="text-sm text-muted"><span className="@min-[40rem]/prices:sr-only">per </span>{item.unit}</span>
                <span className="text-sm tabular-nums @min-[40rem]/prices:text-right">{formatMoney(item.unitAmountMinor, item.currency)} <span className="text-xs text-subtle">{item.currency}</span></span>
                {mayManage ? <span className="@min-[40rem]/prices:w-24 @min-[40rem]/prices:text-right"><Button ref={(node) => { triggers.current.set(item.id, node); }} tone="secondary" size="tiny" disabled={editing !== null} aria-label={`Edit ${item.name}`} onClick={() => setEditing(item.id)}>Edit</Button></span> : <span />}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState className="m-3">No services priced yet.{mayAdd ? ' Add the first thing you charge for.' : ''}</EmptyState>
      )}
    </section>
  );
}
