'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { recordCostComponentAction } from '@/app/organizations/[organizationId]/finance/costs/actions';
import { COST_COMPONENT_INITIAL } from '@/app/organizations/[organizationId]/finance/costs/action-states';
import { ALLOCATION_QUALITY_LABEL, COST_CATEGORY_LABEL } from './cost-labels';

type Option = { value: string; label: string };

/** Records one month's cost component: attributed to one business, or shared across all of them. */
export function RecordCostComponent({ organizationId, businesses, suppliers, currency }: { organizationId: string; businesses: Option[]; suppliers: Option[]; currency: string }) {
  const [state, action, pending] = useActionState(recordCostComponentAction, COST_COMPONENT_INITIAL);
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.recorded) setOpen(false);
  }
  useEffect(() => {
    if (state.recorded) toast.success('Cost recorded.');
  }, [state]);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild><Button>Record cost</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Record cost</PageDrawerTitle></PageDrawerHeader>
        <form action={action} className="flex flex-col gap-4 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-1">
            <FieldLabel htmlFor="cost-category">Kind</FieldLabel>
            <SelectField id="cost-category" name="costCategory" required options={[{ value: '', label: 'Choose kind' }, ...Object.entries(COST_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))]} />
          </div>
          <div className="grid gap-1">
            <FieldLabel htmlFor="cost-allocation">Allocation</FieldLabel>
            <SelectField id="cost-allocation" name="allocationQuality" required options={[{ value: '', label: 'Choose allocation' }, ...Object.entries(ALLOCATION_QUALITY_LABEL).map(([value, label]) => ({ value, label }))]} />
          </div>
          <div className="grid gap-1">
            <FieldLabel htmlFor="cost-business">Business</FieldLabel>
            <SelectField id="cost-business" name="subscriberId" options={[{ value: '', label: 'Shared' }, ...businesses]} />
          </div>
          <div className="grid gap-1">
            <FieldLabel htmlFor="cost-supplier">Supplier</FieldLabel>
            <SelectField id="cost-supplier" name="providerKey" options={[{ value: '', label: 'None' }, ...suppliers]} />
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="cost-amount">Amount</FieldLabel><TextInput id="cost-amount" name="amount" inputMode="decimal" required placeholder="120.00" /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="cost-currency">Currency</FieldLabel><TextInput id="cost-currency" name="currency" defaultValue={currency} minLength={3} maxLength={3} required /></div>
          </div>
          <div className="grid gap-1"><FieldLabel htmlFor="cost-month">Month</FieldLabel><TextInput id="cost-month" name="billingMonth" type="month" required defaultValue={new Date().toISOString().slice(0, 7)} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="cost-source">Source</FieldLabel><TextInput id="cost-source" name="source" required placeholder="Supplier invoice number" /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="cost-note">Note</FieldLabel><TextInput id="cost-note" name="note" /></div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record cost'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
