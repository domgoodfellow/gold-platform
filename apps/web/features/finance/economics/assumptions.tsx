'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { recordMarginTargetsAction, recordUsageAssumptionAction } from '@/app/organizations/[organizationId]/finance/economics/packages/actions';
import { ASSUMPTION_INITIAL, type AssumptionState } from '@/app/organizations/[organizationId]/finance/economics/packages/action-states';

type Option = { value: string; label: string };

function useRecorded(state: AssumptionState, close: () => void, message: string) {
  useEffect(() => {
    if (!state.recorded) return;
    toast.success(message);
    close();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What a plan's margin should be in one currency; the simulator compares each result with it. */
export function MarginTargetsSheet({ organizationId, plans, currency }: { organizationId: string; plans: Option[]; currency: string }) {
  const [state, action, pending] = useActionState(recordMarginTargetsAction, ASSUMPTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Margin targets recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary">Margin targets</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Margin targets</PageDrawerTitle></PageDrawerHeader>
        <form action={action} className="flex flex-col gap-4 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-1"><FieldLabel htmlFor="margin-plan">Plan</FieldLabel><SelectField id="margin-plan" name="planId" required options={plans} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="margin-currency">Currency</FieldLabel><TextInput id="margin-currency" name="currency" defaultValue={currency} minLength={3} maxLength={3} required className="w-24" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="margin-target">Target %</FieldLabel><TextInput id="margin-target" name="targetMargin" type="number" min="0" max="100" step="0.1" required /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="margin-warning">Warn below %</FieldLabel><TextInput id="margin-warning" name="warningMargin" type="number" min="0" max="100" step="0.1" required /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="margin-floor">Floor %</FieldLabel><TextInput id="margin-floor" name="hardFloorMargin" type="number" min="0" max="100" step="0.1" required /></div>
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record targets'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** How much of an allowance a customer on the plan is assumed to use in one usage profile. */
export function UsageAssumptionSheet({ organizationId, plans, allowances }: { organizationId: string; plans: Option[]; allowances: Option[] }) {
  const [state, action, pending] = useActionState(recordUsageAssumptionAction, ASSUMPTION_INITIAL);
  const [open, setOpen] = useState(false);
  useRecorded(state, () => setOpen(false), 'Usage assumption recorded.');
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary">Usage assumptions</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Usage assumption</PageDrawerTitle></PageDrawerHeader>
        <form action={action} className="flex flex-col gap-4 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-1"><FieldLabel htmlFor="usage-plan">Plan</FieldLabel><SelectField id="usage-plan" name="planId" required options={plans} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="usage-profile">Usage profile</FieldLabel><SelectField id="usage-profile" name="scenario" required options={[{ value: 'low', label: 'Low' }, { value: 'expected', label: 'Expected' }, { value: 'heavy', label: 'Heavy' }, { value: 'max_allowance', label: 'Max allowance' }]} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="usage-allowance">Allowance</FieldLabel><SelectField id="usage-allowance" name="allowanceKey" required options={[{ value: '', label: 'Choose an allowance' }, ...allowances]} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="usage-share">Share of the allowance used %</FieldLabel><TextInput id="usage-share" name="utilization" type="number" min="0" max="100" step="1" required className="w-28" /></div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record assumption'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
