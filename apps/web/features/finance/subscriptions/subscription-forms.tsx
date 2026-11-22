'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  prepareAgreedPriceAction,
  recordCommercialTermAction,
  recordPlanAgreementAction,
  recordPlanAssignmentAction,
  recordPlanQuotaOverrideAction,
} from '@/app/organizations/[organizationId]/finance/subscriptions/actions';
import { SUBSCRIPTION_ACTION_INITIAL, type SubscriptionActionState } from '@/app/organizations/[organizationId]/finance/subscriptions/action-states';

type Option = { value: string; label: string };

/** Whose subscription a form changes: the business selling it and the business it serves. */
export type SubscriptionTarget = { organizationId: string; subscriberId: string };

function TargetFields({ target }: { target: SubscriptionTarget }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={target.organizationId} />
      <input type="hidden" name="subscriberId" value={target.subscriberId} />
    </>
  );
}

/** A recorded change closes its drawer and says so in a toast, the shared feedback after an action. */
function useRecorded(state: SubscriptionActionState, close: () => void, message: string) {
  useEffect(() => {
    if (!state.recorded) return;
    toast.success(message);
    close();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The base plan: one per business. An add-on is a separate, stacking decision — see `AddAddonSheet`. */
export function ChangePlanSheet({ target, plans }: { target: SubscriptionTarget; plans: Option[] }) {
  const [state, action, pending] = useActionState(recordPlanAssignmentAction, SUBSCRIPTION_ACTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Plan recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">Change plan</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Change plan</PageDrawerTitle>
          <PageDrawerDescription>A new period does not end an overlapping one; end that first.</PageDrawerDescription>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <TargetFields target={target} />
          <SelectField name="planId" required aria-label="Plan" options={[{ value: '', label: 'Choose a plan…' }, ...plans]} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="periodStart" type="date" required aria-label="Starts" />
            <TextInput name="periodEnd" type="date" required aria-label="Ends" defaultValue="9999-12-31" />
          </div>
          <TextInput name="note" placeholder="Note (optional)" />
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record plan'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** Add-ons stack alongside the base plan through the same effective-dated record. Ending one early is not offered. */
export function AddAddonSheet({ target, addons }: { target: SubscriptionTarget; addons: Option[] }) {
  const [state, action, pending] = useActionState(recordPlanAssignmentAction, SUBSCRIPTION_ACTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Add-on recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">Add add-on</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Add an add-on</PageDrawerTitle>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <TargetFields target={target} />
          <SelectField name="planId" required aria-label="Add-on" options={[{ value: '', label: 'Choose an add-on…' }, ...addons]} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="periodStart" type="date" required aria-label="Starts" />
            <TextInput name="periodEnd" type="date" required aria-label="Ends" defaultValue="9999-12-31" />
          </div>
          <TextInput name="note" placeholder="Note (optional)" />
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record add-on'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** An agreed price for the plan this business holds, effective-dated; the plan's list price is unchanged. */
export function AgreePriceSheet({ target, planId, planLabel, currency }: { target: SubscriptionTarget; planId: string; planLabel: string; currency: string }) {
  const [state, action, pending] = useActionState(recordPlanAgreementAction, SUBSCRIPTION_ACTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Agreed price recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">Agree a price</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Agree a price for {planLabel}</PageDrawerTitle>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <TargetFields target={target} />
          <input type="hidden" name="planId" value={planId} />
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <TextInput name="amount" type="number" min="0" step="0.01" required aria-label="Monthly price" placeholder="699.00" />
            <TextInput name="currency" defaultValue={currency} minLength={3} maxLength={3} required aria-label="Currency" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput name="effectiveFrom" type="date" required aria-label="From" />
            <TextInput name="effectiveTo" type="date" aria-label="Until (optional)" />
          </div>
          <TextInput name="note" placeholder="Where it was agreed" />
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record price'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** A business-specific allowance; the plan's own allowance stays visible beside it. */
export function OverrideAllowanceSheet({ target, planId, allowances }: { target: SubscriptionTarget; planId: string; allowances: Array<{ allowanceKey: string; label: string; includedQuantity: number }> }) {
  const [state, action, pending] = useActionState(recordPlanQuotaOverrideAction, SUBSCRIPTION_ACTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Allowance recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">Change an allowance</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Change an allowance</PageDrawerTitle>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <TargetFields target={target} />
          <input type="hidden" name="planId" value={planId} />
          <SelectField name="allowanceKey" required aria-label="Allowance" options={[{ value: '', label: 'Choose an allowance…' }, ...allowances.map((allowance) => ({ value: allowance.allowanceKey, label: `${allowance.label} · plan includes ${allowance.includedQuantity.toLocaleString()}` }))]} />
          <TextInput name="includedQuantity" type="number" min="0" required aria-label="Included" />
          <TextInput name="hardLimit" type="number" min="0" aria-label="Hard limit" placeholder="No hard limit" />
          <TextInput name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} aria-label="From" />
          <TextInput name="note" placeholder="Where it was agreed" />
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record allowance'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** A per-product term from before plans: kept so existing businesses can still be served on them. */
export function RecordTermForm({ target, products }: { target: SubscriptionTarget; products: Option[] }) {
  const [state, action, pending] = useActionState(recordCommercialTermAction, SUBSCRIPTION_ACTION_INITIAL);
  useEffect(() => {
    if (state.recorded) toast.success('Term recorded.');
  }, [state]);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-2">
      <TargetFields target={target} />
      <SelectField name="productKey" required aria-label="Product" options={[{ value: '', label: 'What was sold…' }, ...products]} />
      <div className="grid grid-cols-2 gap-2">
        <TextInput name="periodStart" type="date" required aria-label="Starts" />
        <TextInput name="periodEnd" type="date" required aria-label="Ends" />
      </div>
      <div className="flex gap-2">
        <TextInput name="priceMinor" type="number" min={0} step={1} required placeholder="Minor units" aria-label="Price in minor units" />
        <TextInput name="currency" maxLength={3} placeholder="USD" className="w-24" aria-label="Currency" />
      </div>
      <ErrorText role="alert">{state.error}</ErrorText>
      <Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record term'}</Button>
    </form>
  );
}

/** Prepares the current agreed price for checkout with GildOps' billing provider; safe to repeat. */
export function PrepareAgreedPriceButton({ target, planId }: { target: SubscriptionTarget; planId: string }) {
  const [state, action, pending] = useActionState(prepareAgreedPriceAction, SUBSCRIPTION_ACTION_INITIAL);
  useEffect(() => {
    if (state.recorded) toast.success('Agreed price is ready for checkout.');
    if (state.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action}>
      <TargetFields target={target} />
      <input type="hidden" name="planId" value={planId} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Setting up…' : 'Set up for checkout'}</Button>
    </form>
  );
}

