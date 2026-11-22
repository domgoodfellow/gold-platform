'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, TextArea, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import {
  PageDrawer,
  PageDrawerBody,
  PageDrawerContent,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { SectionHeader } from '@/components/surfaces/section';
import {
  createRecurringItemAction,
  provisionItemPriceAction,
  recordItemPriceAction,
  recordUsagePriceAction,
  setItemAddonAction,
  updateRecurringItemAction,
  type RecurringItemState,
} from '@/app/organizations/[organizationId]/finance/catalog/recurring-actions';
import type { RecurringItemRow } from '@/lib/application/finance/recurring-items';
import { priceText, type ItemPrice, type ItemSaleStatus, type ItemSwitch, type RecurringItem } from '@/lib/domain/pricing/recurring-items';
import type { ItemProviderPrice, MeteredAllowance, UsagePrice } from '@/lib/domain/pricing/item-provider-prices';
import { formatMicros } from '@/lib/domain/pricing/money-input';

const INITIAL: RecurringItemState = { error: null };

const SALE_LABEL: Record<ItemSaleStatus, string> = { active: 'Offered', unlisted: 'Not offered', archived: 'Retired' };

function useToast(state: RecurringItemState) {
  useEffect(() => { if (state.success) toast.success(state.success); }, [state]);
}

/** The day a price starts or ends, written the same on the server and in the browser. */
function priceDay(iso: string): string {
  return iso.slice(0, 10);
}

function kindLabel(item: RecurringItem): string | null {
  if (!item.plan) return null;
  return item.plan.kind === 'plan' ? 'Plan' : 'Add-on';
}

/** The catalog's recurring items, beside the one-off price book. */
export function RecurringItemsSection({ organizationId, items, mayManage, sellsPlans = false }: { organizationId: string; items: RecurringItemRow[]; mayManage: boolean; sellsPlans?: boolean }) {
  const href = (item: RecurringItem) => `/organizations/${organizationId}/finance/catalog/${item.id}`;
  return (
    <section aria-labelledby="recurring-items-heading" className="@container mt-8">
      <SectionHeader
        id="recurring-items-heading"
        title={<>Recurring items <span className="text-sm font-normal text-muted">({items.length})</span></>}
        action={mayManage ? <NewRecurringItemDrawer organizationId={organizationId} sellsPlans={sellsPlans} /> : undefined}
      />
      <div className="mt-3">
        <DataTable
          rows={items}
          rowKey={(item) => item.id}
          empty="Nothing is charged every month or year yet."
          tableFrom="medium"
          columns={[
            { key: 'name', header: 'Item', emphasis: 'primary', cell: (item) => <Link href={href(item)} className="font-medium underline-offset-4 hover:underline">{item.name}</Link> },
            { key: 'kind', header: 'Kind', cell: (item) => kindLabel(item) ?? item.unit },
            {
              key: 'price',
              header: 'Current price',
              cell: (item) => item.current.length === 0 ? <span className="text-muted">No price</span> : item.current.map(priceText).join(' · '),
            },
            { key: 'status', header: 'Status', cell: (item) => item.saleStatus === 'active' ? SALE_LABEL.active : <Badge>{SALE_LABEL[item.saleStatus]}</Badge> },
          ]}
        />
      </div>
    </section>
  );
}

/**
 * A new recurring item. In GildOps' own organization it can be a GildOps plan or add-on, created
 * with an empty switch list that Product Registry fills on the item's own page.
 */
function NewRecurringItemDrawer({ organizationId, sellsPlans }: { organizationId: string; sellsPlans: boolean }) {
  const formId = useId();
  const kindId = useId();
  const [kind, setKind] = useState<'item' | 'plan' | 'addon'>('item');
  const router = useRouter();
  const [state, action, pending] = useActionState(createRecurringItemAction, INITIAL);
  useEffect(() => {
    if (!state.success || !state.itemId) return;
    toast.success(state.success);
    router.push(`/organizations/${organizationId}/finance/catalog/${state.itemId}`);
  }, [state, organizationId, router]);
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild>
        <Button size="small"><Plus aria-hidden className="size-4" />New recurring item</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>New recurring item</PageDrawerTitle></PageDrawerHeader>
        <PageDrawerBody>
          <form id={formId} action={action} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            {sellsPlans ? (
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={kindId}>Kind</FieldLabel>
                <SelectField
                  id={kindId}
                  name="kind"
                  value={kind}
                  onValueChange={(next) => setKind(next as typeof kind)}
                  options={[{ value: 'item', label: 'Recurring item' }, { value: 'plan', label: 'GildOps plan' }, { value: 'addon', label: 'GildOps add-on' }]}
                />
              </div>
            ) : null}
            <ItemFields chargedPer={kind === 'item'} />
            <ErrorText role="alert">{state.error}</ErrorText>
          </form>
        </PageDrawerBody>
        <PageDrawerFooter><Button type="submit" form={formId} disabled={pending}>{pending ? 'Creating…' : 'Create'}</Button></PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

function ItemFields({ item, chargedPer = true }: { item?: RecurringItem; chargedPer?: boolean }) {
  const id = useId();
  return (
    <>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <TextInput id={`${id}-name`} name="name" required maxLength={chargedPer ? 200 : 120} defaultValue={item?.name} />
      </div>
      {chargedPer ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-unit`}>Charged per</FieldLabel>
          <TextInput id={`${id}-unit`} name="unit" required maxLength={40} defaultValue={item?.unit ?? 'subscription'} />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
        <TextArea id={`${id}-description`} name="description" rows={3} maxLength={2000} defaultValue={item?.description} />
      </div>
    </>
  );
}

export function EditRecurringItemDrawer({ organizationId, item }: { organizationId: string; item: RecurringItem }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateRecurringItemAction, INITIAL);
  useToast(state);
  // A saved form closes its drawer: adjusted while rendering the new result, not in an effect.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) setOpen(false);
  }
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button tone="secondary" size="small">Edit</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Edit {item.name}</PageDrawerTitle></PageDrawerHeader>
        <PageDrawerBody>
          <form id={formId} action={action} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="itemId" value={item.id} />
            <ItemFields item={item} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${formId}-sale`}>Offered</FieldLabel>
              <SelectField id={`${formId}-sale`} name="saleStatus" defaultValue={item.saleStatus}
                options={(['active', 'unlisted', 'archived'] as const).map((value) => ({ value, label: SALE_LABEL[value] }))} />
            </div>
            <ErrorText role="alert">{state.error}</ErrorText>
          </form>
        </PageDrawerBody>
        <PageDrawerFooter><Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button></PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function PriceHistory({
  organizationId, item, prices, current, mayManage, environment, providerByPrice, defaultCurrency,
}: {
  organizationId: string;
  item: RecurringItem;
  prices: ItemPrice[];
  current: ItemPrice[];
  mayManage: boolean;
  environment: 'sandbox' | 'live' | null;
  providerByPrice: Map<string, ItemProviderPrice>;
  defaultCurrency: string;
}) {
  const currentIds = new Set(current.map((price) => price.id));
  const checkout = item.plan !== null;
  return (
    <section aria-labelledby="prices-heading" className="@container mt-8">
      <SectionHeader id="prices-heading" title="Prices" action={mayManage ? <RecordPriceDrawer organizationId={organizationId} itemId={item.id} defaultCurrency={defaultCurrency} /> : undefined} />
      <div className="mt-3">
        <DataTable
          rows={prices}
          rowKey={(price) => price.id}
          empty="No price is recorded yet."
          tableFrom="medium"
          columns={[
            { key: 'price', header: 'Price', emphasis: 'primary', cell: (price) => priceText(price) },
            { key: 'from', header: 'From', cell: (price) => priceDay(price.effectiveFrom) },
            { key: 'to', header: 'Until', cell: (price) => price.effectiveTo ? priceDay(price.effectiveTo) : '—', cardValue: (price) => price.effectiveTo ? priceDay(price.effectiveTo) : null },
            { key: 'state', header: 'State', cell: (price) => currentIds.has(price.id) ? <Badge tone="success">Current</Badge> : price.approvalState === 'draft' ? <Badge>Draft</Badge> : null },
            ...(checkout ? [{
              key: 'checkout',
              header: 'Checkout',
              cell: (price: ItemPrice) => <CheckoutCell organizationId={organizationId} itemId={item.id} price={price} environment={environment} provisioned={providerByPrice.get(price.id) ?? null} mayManage={mayManage} />,
            }] : []),
          ]}
        />
      </div>
    </section>
  );
}

function CheckoutCell({ organizationId, itemId, price, environment, provisioned, mayManage }: {
  organizationId: string; itemId: string; price: ItemPrice; environment: 'sandbox' | 'live' | null; provisioned: ItemProviderPrice | null; mayManage: boolean;
}) {
  const [state, action, pending] = useActionState(provisionItemPriceAction, INITIAL);
  useToast(state);
  if (!environment) return <span className="text-muted">Billing not set up</span>;
  if (provisioned) return <Badge tone="success">Ready ({environment})</Badge>;
  if (!mayManage || price.approvalState !== 'approved') return <span className="text-muted">Not ready</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="priceId" value={price.id} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Preparing…' : `Prepare for checkout (${environment})`}</Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

function RecordPriceDrawer({ organizationId, itemId, defaultCurrency }: { organizationId: string; itemId: string; defaultCurrency: string }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordItemPriceAction, INITIAL);
  useToast(state);
  // A saved form closes its drawer: adjusted while rendering the new result, not in an effect.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) setOpen(false);
  }
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button size="small"><Plus aria-hidden className="size-4" />Record price</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Record price</PageDrawerTitle></PageDrawerHeader>
        <PageDrawerBody>
          <form id={formId} action={action} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="itemId" value={itemId} />
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${formId}-amount`}>Amount</FieldLabel>
                <TextInput id={`${formId}-amount`} name="amount" inputMode="decimal" required placeholder="49.00" />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${formId}-currency`}>Currency</FieldLabel>
                <TextInput id={`${formId}-currency`} name="currency" required maxLength={3} defaultValue={defaultCurrency} className="uppercase" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${formId}-interval`}>Charged</FieldLabel>
              <SelectField id={`${formId}-interval`} name="billingInterval" defaultValue="month"
                options={[{ value: 'month', label: 'Every month' }, { value: 'year', label: 'Every year' }, { value: 'one_time', label: 'Once' }]} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${formId}-from`}>Starts</FieldLabel>
              <TextInput id={`${formId}-from`} name="effectiveFrom" type="date" />
            </div>
            <ErrorText role="alert">{state.error}</ErrorText>
          </form>
        </PageDrawerBody>
        <PageDrawerFooter><Button type="submit" form={formId} disabled={pending}>{pending ? 'Recording…' : 'Record'}</Button></PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function AddonsSection({ organizationId, itemId, addons, options, mayManage }: {
  organizationId: string; itemId: string; addons: RecurringItem[]; options: RecurringItem[]; mayManage: boolean;
}) {
  return (
    <section aria-labelledby="addons-heading" className="mt-8">
      <SectionHeader id="addons-heading" title="Add-ons" action={mayManage && options.length > 0 ? <AddAddonForm organizationId={organizationId} itemId={itemId} options={options} /> : undefined} />
      {addons.length === 0 ? <p className="mt-3 text-sm text-muted">No add-ons are offered with this item.</p> : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {addons.map((addon) => (
            <li key={addon.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <Link href={`/organizations/${organizationId}/finance/catalog/${addon.id}`} className="text-sm underline-offset-4 hover:underline">{addon.name}</Link>
              {mayManage ? <RemoveAddonButton organizationId={organizationId} itemId={itemId} addon={addon} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddAddonForm({ organizationId, itemId, options }: { organizationId: string; itemId: string; options: RecurringItem[] }) {
  const [state, action, pending] = useActionState(setItemAddonAction, INITIAL);
  useToast(state);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="attached" value="true" />
      <SelectField id={id} name="addonItemId" size="small" aria-label="Add-on to offer" options={options.map((option) => ({ value: option.id, label: option.name }))} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>Offer</Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

function RemoveAddonButton({ organizationId, itemId, addon }: { organizationId: string; itemId: string; addon: RecurringItem }) {
  const [state, action, pending] = useActionState(setItemAddonAction, INITIAL);
  useToast(state);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="addonItemId" value={addon.id} />
      <input type="hidden" name="attached" value="false" />
      <Button type="submit" tone="secondary" size="small" disabled={pending} aria-label={`Stop offering ${addon.name}`}>Remove</Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

const SWITCH_GROUP: Record<ItemSwitch['kind'], string> = {
  product: 'Products', module: 'Feature groups', feature: 'Features added', excluded_feature: 'Features left out', allowance: 'Allowances',
};

/** What a plan item switches on. Set in Product Registry; read here. */
export function SwitchesSection({ switches }: { switches: ItemSwitch[] }) {
  const groups = (Object.keys(SWITCH_GROUP) as ItemSwitch['kind'][])
    .map((kind) => ({ kind, rows: switches.filter((row) => row.kind === kind) }))
    .filter((group) => group.rows.length > 0);
  return (
    <section aria-labelledby="switches-heading" className="mt-8">
      <SectionHeader id="switches-heading" title="Includes" />
      {groups.length === 0 ? <p className="mt-3 text-sm text-muted">This plan switches nothing on yet.</p> : (
        <dl className="mt-3 grid gap-4 @min-[40rem]:grid-cols-2">
          {groups.map((group) => (
            <div key={group.kind}>
              <dt className="text-sm font-medium">{SWITCH_GROUP[group.kind]}</dt>
              <dd className="mt-1">
                <ul className="flex flex-col gap-0.5 text-sm">
                  {group.rows.map((row) => <li key={`${row.label}-${row.detail}`}>{row.label}{row.detail ? <span className="text-muted"> · {row.detail}</span> : null}</li>)}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function UsagePricesSection({ organizationId, itemId, allowances, usagePrices, mayManage, defaultCurrency }: {
  organizationId: string; itemId: string; allowances: MeteredAllowance[]; usagePrices: UsagePrice[]; mayManage: boolean; defaultCurrency: string;
}) {
  if (allowances.length === 0) return null;
  return (
    <section aria-labelledby="usage-prices-heading" className="mt-8">
      <SectionHeader id="usage-prices-heading" title="Usage beyond the allowance" />
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {allowances.map((allowance) => {
          const current = usagePrices.find((price) => price.meterId === allowance.meterId && price.effectiveFrom <= new Date().toISOString());
          return (
            <li key={allowance.allowanceKey} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>{allowance.label}</span>
              <span className="flex flex-wrap items-center gap-3">
                <span className={current ? '' : 'text-muted'}>{current ? `${formatMicros(current.unitAmountMicros, current.currency)} / ${allowance.unit}` : 'No price'}</span>
                {mayManage ? <RecordUsagePriceDrawer organizationId={organizationId} itemId={itemId} allowance={allowance} defaultCurrency={current?.currency ?? defaultCurrency} /> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecordUsagePriceDrawer({ organizationId, itemId, allowance, defaultCurrency }: { organizationId: string; itemId: string; allowance: MeteredAllowance; defaultCurrency: string }) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordUsagePriceAction, INITIAL);
  useToast(state);
  // A saved form closes its drawer: adjusted while rendering the new result, not in an effect.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success) setOpen(false);
  }
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button tone="secondary" size="small" aria-label={`Record price for ${allowance.label}`}>Record price</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>{allowance.label}</PageDrawerTitle></PageDrawerHeader>
        <PageDrawerBody>
          <form id={formId} action={action} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="meterId" value={allowance.meterId} />
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${formId}-amount`}>Price per {allowance.unit}</FieldLabel>
                <TextInput id={`${formId}-amount`} name="amount" inputMode="decimal" required placeholder="0.0125" />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${formId}-currency`}>Currency</FieldLabel>
                <TextInput id={`${formId}-currency`} name="currency" required maxLength={3} defaultValue={defaultCurrency} className="uppercase" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${formId}-from`}>Starts</FieldLabel>
              <TextInput id={`${formId}-from`} name="effectiveFrom" type="date" />
            </div>
            <ErrorText role="alert">{state.error}</ErrorText>
          </form>
        </PageDrawerBody>
        <PageDrawerFooter><Button type="submit" form={formId} disabled={pending}>{pending ? 'Recording…' : 'Record'}</Button></PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}
