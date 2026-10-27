'use client';

import { useRef, useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { PriceItemRowForm } from './price-forms';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const ROW = 'grid gap-1 px-3 py-3 @min-[40rem]/prices:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @min-[40rem]/prices:items-center @min-[40rem]/prices:gap-2';

/**
 * The price book, edited where it is read. An item is a name, a unit and an amount in the currency
 * it was priced in, so adding or re-pricing one happens in its own row rather than in a dialog that
 * repeated the row beside it. One row is edited at a time: the other Edit buttons wait, so a change
 * is never abandoned by opening another. Saving is still one write per item through the existing
 * actions; items keep their name order, and there is no delete or archive to offer. An item priced
 * in an earlier trading currency says so rather than being converted.
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
  const add = mayAdd ? <Button ref={(node) => { triggers.current.set('new', node); }} size="small" disabled={editing !== null} onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add price item</Button> : null;

  return (
    <section aria-labelledby="price-book-heading" className="@container/prices mt-4 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <h2 id="price-book-heading" className="font-semibold">Price book <span className="text-sm font-normal text-muted">({items.length})</span></h2>
        {add}
      </div>
      {mayManage && !currency ? <Hint className="px-3 pb-3">Choose a trading currency before adding prices.</Hint> : null}
      {items.length || editing === 'new' ? (
        <>
          <div aria-hidden className={`${ROW} hidden border-y border-border text-xs font-medium text-muted @min-[40rem]/prices:grid`}><span>Price item</span><span>Unit</span><span className="text-right">Unit price</span><span className="w-24" /></div>
          <ul className="divide-y divide-border">
            {editing === 'new' && currency ? <li><PriceItemRowForm organizationId={organizationId} currency={currency} onDone={() => close('new')} onCancel={() => close('new')} /></li> : null}
            {items.map((item) => editing === item.id ? (
              <li key={item.id}><PriceItemRowForm organizationId={organizationId} item={item} currency={item.currency} onDone={() => close(item.id)} onCancel={() => close(item.id)} /></li>
            ) : (
              <li key={item.id} className={ROW}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted"><Tag className="size-3.5" /></span>
                  <span className="min-w-0"><span className="block break-words font-medium">{item.name}</span>{currency && item.currency !== currency ? <Badge className="mt-0.5">Priced in {item.currency}</Badge> : null}</span>
                </span>
                <span className="pl-9.5 text-sm text-muted @min-[40rem]/prices:pl-0">per {item.unit}</span>
                <span className="pl-9.5 text-sm font-semibold tabular-nums @min-[40rem]/prices:pl-0 @min-[40rem]/prices:text-right">{formatMoney(item.unitAmountMinor, item.currency)} <span className="text-xs font-normal text-subtle">{item.currency}</span></span>
                {mayManage ? <span className="pl-9.5 @min-[40rem]/prices:w-24 @min-[40rem]/prices:pl-0 @min-[40rem]/prices:text-right"><Button ref={(node) => { triggers.current.set(item.id, node); }} tone="secondary" size="tiny" disabled={editing !== null} aria-label={`Edit ${item.name}`} onClick={() => setEditing(item.id)}>Edit</Button></span> : <span />}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-1 border-t border-border px-3 py-4 text-sm">
          <p className="font-medium">Nothing is priced yet.</p>
          <p className="max-w-prose text-muted">{mayAdd ? 'Use Add price item for each thing this business charges: a name, a unit such as hour or visit, and a price.' : 'Price items appear here once someone who manages pricing adds them.'} Quoting Work copies these prices; it creates no Work.</p>
        </div>
      )}
    </section>
  );
}
