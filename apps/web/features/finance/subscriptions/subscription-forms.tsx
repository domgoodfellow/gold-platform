'use client';

import { useActionState, useEffect, useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { SelectField } from '@/components/controls/select-field';
import { RecordPicker } from '@/components/patterns/transaction-review';
import {
  PageDrawer,
  PageDrawerBody,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { choiceStatus, useFinanceRecord } from '@/features/finance/transactions/use-finance-record';
import {
  addSubscriptionAddonAction,
  cancelSubscriptionAction,
  changeSubscriptionItemAction,
  createSubscriptionAction,
  endSubscriptionAddonAction,
  issueSubscriptionInvoiceAction,
  prepareAgreedPriceAction,
  recordCommercialTermAction,
  recordPlanQuotaOverrideAction,
  setSubscriptionPriceAction,
  setSubscriptionUsagePriceAction,
} from '@/app/organizations/[organizationId]/finance/subscriptions/actions';
import { SUBSCRIPTION_ACTION_INITIAL, type SubscriptionActionState } from '@/app/organizations/[organizationId]/finance/subscriptions/action-states';

type Option = { value: string; label: string };

/** Which subscription a form changes, in which business, and in what currency its amounts are typed. */
export type SubscriptionTarget = { organizationId: string; subscriptionId: string; currency: string };

function TargetFields({ target }: { target: SubscriptionTarget }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={target.organizationId} />
      <input type="hidden" name="subscriptionId" value={target.subscriptionId} />
      <input type="hidden" name="currency" value={target.currency} />
    </>
  );
}

/** A recorded change closes its drawer and says so in a toast, the shared feedback after an action. */
function useRecorded(state: SubscriptionActionState, close: () => void, message: string, then?: (state: SubscriptionActionState) => void) {
  useEffect(() => {
    if (!state.recorded) return;
    toast.success(message);
    close();
    then?.(state);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One drawer per change: a trigger, a title and the form. */
function ChangeDrawer({ trigger, title, open, onOpenChange, children }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <PageDrawer open={open} onOpenChange={onOpenChange}>
      <PageDrawerTrigger asChild>{trigger}</PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>{title}</PageDrawerTitle></PageDrawerHeader>
        <PageDrawerBody>{children}</PageDrawerBody>
      </PageDrawerContent>
    </PageDrawer>
  );
}

function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: ReactNode; children: (props: { id: string }) => ReactNode }) {
  const id = useId();
  return <FormField id={id} label={label} optional={optional} hint={hint}>{(props) => children(props)}</FormField>;
}

function Submit({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return <FormActions><Button type="submit" size="small" disabled={pending}>{pending ? busy : idle}</Button></FormActions>;
}

const INTERVALS: Option[] = [{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }];

/** A new subscription: one of this business's customers, one of its recurring items, and the terms it is billed on. */
export function NewSubscriptionSheet({ organizationId, currency, items, today }: { organizationId: string; currency: string; items: Option[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createSubscriptionAction, SUBSCRIPTION_ACTION_INITIAL);
  const customer = useFinanceRecord<{ id: string }>(organizationId, 'customer', undefined, { load: async (_organization, id) => ({ id }) });
  useRecorded(state, () => setOpen(false), 'Subscription recorded.', (result) => {
    if (result.id) router.push(`/organizations/${organizationId}/finance/subscriptions/${result.id}`);
  });
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="New subscription" trigger={<Button type="button" size="small">New subscription</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="customerId" value={customer.selected} />
        <RecordPicker
          legend="Customer"
          search={{ value: customer.q, onChange: customer.setQ, label: 'Search customers', placeholder: 'Name, email or phone' }}
          choices={(customer.choices?.rows ?? []).map((row) => ({ id: row.id, title: row.title, detail: row.detail }))}
          selected={customer.selected}
          onSelect={customer.choose}
          status={choiceStatus(customer.searching, customer.choices, 'customers')}
          empty={customer.choices && !customer.searching ? <p className="text-sm">{customer.q ? 'No customer matches this search.' : 'There are no customers yet.'}</p> : null}
        />
        <Field label="Recurring item">{(props) => <SelectField {...props} name="itemId" required options={[{ value: '', label: 'Choose an item…' }, ...items]} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Billed">{(props) => <SelectField {...props} name="billingInterval" defaultValue="month" options={INTERVALS} />}</Field>
          <Field label="Currency">{(props) => <TextInput {...props} name="currency" defaultValue={currency} minLength={3} maxLength={3} required />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(props) => <TextInput {...props} name="startsOn" type="date" required defaultValue={today} />}</Field>
          <Field label="Ends" optional>{(props) => <TextInput {...props} name="endsOn" type="date" />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">{(props) => <TextInput {...props} name="quantity" type="number" min={1} step={1} defaultValue="1" required />}</Field>
          <Field label="Agreed price" optional hint="Empty uses the list price.">{(props) => <TextInput {...props} name="agreedAmount" inputMode="decimal" placeholder="49.00" />}</Field>
        </div>
        <Field label="Note" optional>{(props) => <TextInput {...props} name="note" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record subscription" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

/** A different primary item from a date: the current one ends there and the new one starts. */
export function ChangeItemSheet({ target, items, today }: { target: SubscriptionTarget; items: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(changeSubscriptionItemAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Change recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Change item" trigger={<Button type="button" tone="secondary" size="small">Change item</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <Field label="Recurring item">{(props) => <SelectField {...props} name="itemId" required options={[{ value: '', label: 'Choose an item…' }, ...items]} />}</Field>
        <Field label="From">{(props) => <TextInput {...props} name="effectiveOn" type="date" required defaultValue={today} />}</Field>
        <Field label="Agreed price" optional hint="Empty uses the list price.">{(props) => <TextInput {...props} name="agreedAmount" inputMode="decimal" placeholder="49.00" />}</Field>
        <Field label="Note" optional>{(props) => <TextInput {...props} name="note" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record change" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

export function AddAddonSheet({ target, addons, today }: { target: SubscriptionTarget; addons: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addSubscriptionAddonAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Add-on recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Add an add-on" trigger={<Button type="button" tone="secondary" size="small">Add add-on</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <Field label="Add-on">{(props) => <SelectField {...props} name="itemId" required options={[{ value: '', label: 'Choose an add-on…' }, ...addons]} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(props) => <TextInput {...props} name="startsOn" type="date" required defaultValue={today} />}</Field>
          <Field label="Quantity">{(props) => <TextInput {...props} name="quantity" type="number" min={1} step={1} defaultValue="1" required />}</Field>
        </div>
        <Field label="Agreed price" optional hint="Empty uses the list price.">{(props) => <TextInput {...props} name="agreedAmount" inputMode="decimal" placeholder="19.00" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record add-on" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

/** An agreed price for one line from now, or back to the item's list price. */
export function SetPriceSheet({ target, lines }: { target: SubscriptionTarget; lines: Option[] }) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<'agreed' | 'list'>('agreed');
  const [state, action, pending] = useActionState(setSubscriptionPriceAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), basis === 'list' ? 'List price restored.' : 'Agreed price recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Change price" trigger={<Button type="button" tone="secondary" size="small">Change price</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <Field label="Line">{(props) => <SelectField {...props} name="lineId" required defaultValue={lines[0]?.value} options={lines} />}</Field>
        <Field label="Price from now">{(props) => <SelectField {...props} name="basis" value={basis} onValueChange={(value) => setBasis(value === 'list' ? 'list' : 'agreed')} options={[{ value: 'agreed', label: 'An agreed price' }, { value: 'list', label: 'The list price' }]} />}</Field>
        {basis === 'agreed' ? <Field label={`Agreed price (${target.currency})`}>{(props) => <TextInput {...props} name="amount" inputMode="decimal" required placeholder="49.00" />}</Field> : null}
        <Field label="Note" optional>{(props) => <TextInput {...props} name="note" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record price" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

export function EndAddonSheet({ target, addons, today }: { target: SubscriptionTarget; addons: Option[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(endSubscriptionAddonAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Add-on ended.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="End an add-on" trigger={<Button type="button" tone="secondary" size="small">End add-on</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <Field label="Add-on">{(props) => <SelectField {...props} name="lineId" required defaultValue={addons[0]?.value} options={addons} />}</Field>
        <LastDayField today={today} hint="Service ends after this day." />
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="End add-on" busy="Ending…" />
      </form>
    </ChangeDrawer>
  );
}

/** The database ends a line on its first day without service; people choose the last day with it. */
function LastDayField({ today, hint }: { today: string; hint: string }) {
  const [lastDay, setLastDay] = useState(today);
  const next = lastDay ? new Date(`${lastDay}T00:00:00Z`) : null;
  if (next) next.setUTCDate(next.getUTCDate() + 1);
  return (
    <>
      <Field label="Last day" hint={hint}>{(props) => <TextInput {...props} type="date" required value={lastDay} onChange={(event) => setLastDay(event.target.value)} />}</Field>
      <input type="hidden" name="endsOn" value={next ? next.toISOString().slice(0, 10) : ''} />
    </>
  );
}

export function CancelSubscriptionSheet({ target, today }: { target: SubscriptionTarget; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelSubscriptionAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Subscription ended.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="End subscription" trigger={<Button type="button" tone="secondary" size="small">End subscription</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <LastDayField today={today} hint="Service and billing end after this day." />
        <Field label="Reason" optional>{(props) => <TextInput {...props} name="reason" maxLength={500} />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="End subscription" busy="Ending…" />
      </form>
    </ChangeDrawer>
  );
}

/** Invoices the next period of a subscription Finance collects itself. */
export function IssueInvoiceSheet({ target, period }: { target: SubscriptionTarget; period: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [issuanceKey, setIssuanceKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(issueSubscriptionInvoiceAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Invoice issued.', (result) => {
    setIssuanceKey(crypto.randomUUID());
    if (result.id) router.push(`/organizations/${target.organizationId}/finance/invoices?invoice=${result.id}`);
  });
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Invoice next period" trigger={<Button type="button" size="small">Invoice next period</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <input type="hidden" name="issuanceKey" value={issuanceKey} />
        <p className="text-sm">{period}</p>
        <Field label="Due" optional>{(props) => <TextInput {...props} name="dueOn" type="date" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Issue invoice" busy="Issuing…" />
      </form>
    </ChangeDrawer>
  );
}

/** An agreed usage price on one plan line, from now; empty returns the meter to the plan's usage price. */
export function UsagePriceSheet({ target, lineId, meters }: { target: SubscriptionTarget; lineId: string; meters: Option[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setSubscriptionUsagePriceAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Usage price recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Agree a usage price" trigger={<Button type="button" tone="secondary" size="small">Agree a usage price</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <input type="hidden" name="lineId" value={lineId} />
        <Field label="Meter">{(props) => <SelectField {...props} name="meterId" required options={[{ value: '', label: 'Choose a meter…' }, ...meters]} />}</Field>
        <Field label={`Price per unit (${target.currency})`} optional hint="Empty returns it to the plan's usage price.">{(props) => <TextInput {...props} name="unitAmount" inputMode="decimal" placeholder="0.012" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record usage price" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

/** A business-specific allowance for the business this subscription provisions; the plan's own allowance stays beside it. */
export function OverrideAllowanceSheet({ target, tenantId, planId, allowances, today }: { target: SubscriptionTarget; tenantId: string; planId: string; allowances: Array<{ allowanceKey: string; label: string; includedQuantity: number }>; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPlanQuotaOverrideAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Allowance recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Change an allowance" trigger={<Button type="button" tone="secondary" size="small">Change an allowance</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="planId" value={planId} />
        <Field label="Allowance">{(props) => <SelectField {...props} name="allowanceKey" required options={[{ value: '', label: 'Choose an allowance…' }, ...allowances.map((allowance) => ({ value: allowance.allowanceKey, label: `${allowance.label} · plan includes ${allowance.includedQuantity.toLocaleString()}` }))]} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Included">{(props) => <TextInput {...props} name="includedQuantity" type="number" min={0} required />}</Field>
          <Field label="Hard limit" optional>{(props) => <TextInput {...props} name="hardLimit" type="number" min={0} />}</Field>
        </div>
        <Field label="From">{(props) => <TextInput {...props} name="effectiveFrom" type="date" required defaultValue={today} />}</Field>
        <Field label="Note" optional>{(props) => <TextInput {...props} name="note" />}</Field>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record allowance" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

/** A per-product term from before plans, kept so an older business can still be served on one. */
export function RecordTermSheet({ target, tenantId, products }: { target: SubscriptionTarget; tenantId: string; products: Option[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordCommercialTermAction, SUBSCRIPTION_ACTION_INITIAL);
  useRecorded(state, () => setOpen(false), 'Term recorded.');
  return (
    <ChangeDrawer open={open} onOpenChange={setOpen} title="Record a per-product term" trigger={<Button type="button" tone="secondary" size="small">Record a term</Button>}>
      <form action={action} className="flex flex-col gap-4">
        <TargetFields target={target} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <Field label="Product">{(props) => <SelectField {...props} name="productKey" required options={[{ value: '', label: 'What was sold…' }, ...products]} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(props) => <TextInput {...props} name="periodStart" type="date" required />}</Field>
          <Field label="Ends">{(props) => <TextInput {...props} name="periodEnd" type="date" required />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price in minor units">{(props) => <TextInput {...props} name="priceMinor" type="number" min={0} step={1} required />}</Field>
          <Field label="Currency" optional>{(props) => <TextInput {...props} name="termCurrency" maxLength={3} />}</Field>
        </div>
        <FormError>{state.error}</FormError>
        <Submit pending={pending} idle="Record term" busy="Recording…" />
      </form>
    </ChangeDrawer>
  );
}

/** Prepares the current agreed plan price for checkout with the billing provider; safe to repeat. */
export function PrepareAgreedPriceButton({ target, tenantId, planId }: { target: SubscriptionTarget; tenantId: string; planId: string }) {
  const [state, action, pending] = useActionState(prepareAgreedPriceAction, SUBSCRIPTION_ACTION_INITIAL);
  useEffect(() => {
    if (state.recorded) toast.success('Agreed price is ready for checkout.');
    if (state.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action}>
      <TargetFields target={target} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Setting up…' : 'Set up agreed price for checkout'}</Button>
    </form>
  );
}
