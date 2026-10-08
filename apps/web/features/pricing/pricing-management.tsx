'use client';

import { Button } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { PageDrawer, PageDrawerTrigger, PageDrawerContent, PageDrawerHeader, PageDrawerTitle } from '@/components/panels/page-drawer';
import { CreatePriceItemForm, EditPriceItemForm } from './price-forms';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export function PricingManagement({ organizationId, items, currency, mayManage }: { organizationId: string; items: PriceBookItem[]; currency: string | null; mayManage: boolean }) {
  return <div className="mt-4 rounded-lg border border-border bg-surface p-3"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Price book <span className="text-sm text-muted">({items.length})</span></h2>{mayManage && currency ? <PageDrawer><PageDrawerTrigger asChild><Button size="small">Add price item</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Add price item</PageDrawerTitle></PageDrawerHeader><div className="p-4"><CreatePriceItemForm organizationId={organizationId} currency={currency} /></div></PageDrawerContent></PageDrawer> : null}</div>
    <DataTable rows={items} rowKey={i=>i.id} empty="No services priced yet. Set your currency, then add a price item." columns={[
      {key:'name',header:'Name',emphasis:'primary',cell:i=>i.name},{key:'unit',header:'Unit',cell:i=>i.unit},
      {key:'price',header:'Price',numeric:true,cell:i=>formatMoney(i.unitAmountMinor,i.currency)},{key:'currency',header:'Currency',cell:i=>i.currency},
    ]} actions={mayManage ? i=><PageDrawer><PageDrawerTrigger asChild><Button tone="secondary" size="tiny" aria-label={`Edit ${i.name}`}>Edit</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Edit price item</PageDrawerTitle></PageDrawerHeader><div className="p-4"><p className="mb-4 text-sm text-muted">Currency: {i.currency}. Existing quoted and invoiced lines keep their original prices.</p><EditPriceItemForm organizationId={organizationId} item={i} /></div></PageDrawerContent></PageDrawer> : undefined} />
  </div>;
}
