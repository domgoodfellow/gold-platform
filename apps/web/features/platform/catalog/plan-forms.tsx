'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { createPlanAction, type CreatePlanState } from '@/app/(platform)/platform/catalog/plans/actions';
import {
  grantPlanFeatureOverrideAction,
  grantPlanModuleAction,
  grantPlanProductAction,
  recordPlanPriceAction,
  removePlanQuotaAction,
  revokePlanFeatureOverrideAction,
  revokePlanModuleAction,
  revokePlanProductAction,
  setPlanQuotaAction,
  updatePlanAction,
  type PlanActionState,
} from '@/app/(platform)/platform/catalog/plans/[planKey]/actions';
import type { Plan, PlanQuota } from '@/lib/domain/catalogue/plans';

const CREATE_INITIAL: CreatePlanState = { error: null };
const ACTION_INITIAL: PlanActionState = { error: null, updated: false };

export function CreatePlanSheet() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPlanAction, CREATE_INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">Create Plan</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create a Plan or Add-on</SheetTitle>
          <SheetDescription>The key is permanent once created.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="key">Key</FieldLabel>
            <TextInput id="key" name="key" required pattern="[a-z][a-z0-9_]{1,60}" placeholder="growth" />
            <Hint weight="subtle">Lowercase letters, numbers and underscores only.</Hint>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="kind">Kind</FieldLabel>
            <SelectInput id="kind" name="kind" defaultValue="plan">
              <option value="plan">Plan (one base package per organization)</option>
              <option value="addon">Add-on (stacks alongside a Plan)</option>
            </SelectInput>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <TextInput id="label" name="label" required maxLength={120} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <TextArea id="description" name="description" rows={3} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billable" defaultChecked /> Billable
          </label>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function EditPlanSheet({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updatePlanAction, ACTION_INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {plan.label}</SheetTitle>
          <SheetDescription>Key and kind are permanent.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="planKey" value={plan.key} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <TextInput id="label" name="label" required maxLength={120} defaultValue={plan.label} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <TextArea id="description" name="description" rows={3} defaultValue={plan.description} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="saleStatus">Sale state</FieldLabel>
            <SelectInput id="saleStatus" name="saleStatus" defaultValue={plan.saleStatus}>
              <option value="active">Active</option>
              <option value="unlisted">Unlisted</option>
              <option value="archived">Archived</option>
            </SelectInput>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billable" defaultChecked={plan.billable} /> Billable
          </label>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="displayOrder">Display order</FieldLabel>
            <TextInput id="displayOrder" name="displayOrder" type="number" min={0} defaultValue={plan.displayOrder} className="w-28" />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ProductGrantToggle({ planId, planKey, productKey, granted }: { planId: string; planKey: string; productKey: string; granted: boolean }) {
  const action = granted ? revokePlanProductAction : grantPlanProductAction;
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="productKey" value={productKey} />
      <Button type="submit" tone={granted ? 'secondary' : 'primary'} size="small">
        {granted ? 'Remove whole Product' : 'Include all available Features'}
      </Button>
    </form>
  );
}

export function ModuleGrantToggle({ planId, planKey, moduleId, granted }: { planId: string; planKey: string; moduleId: string; granted: boolean }) {
  const action = granted ? revokePlanModuleAction : grantPlanModuleAction;
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <Button type="submit" tone={granted ? 'secondary' : 'primary'} size="small">
        {granted ? 'Remove Module' : 'Include Module'}
      </Button>
    </form>
  );
}

export function FeatureOverrideControl({
  planId,
  planKey,
  featureId,
  override,
}: {
  planId: string;
  planKey: string;
  featureId: string;
  override: boolean | null; // null = no override, true/false = explicit override
}) {
  return (
    <div className="flex items-center gap-1">
      <form action={grantPlanFeatureOverrideAction}>
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="planKey" value={planKey} />
        <input type="hidden" name="featureId" value={featureId} />
        <input type="hidden" name="included" value="true" />
        <Button type="submit" tone={override === true ? 'primary' : 'secondary'} size="small">
          Include
        </Button>
      </form>
      <form action={grantPlanFeatureOverrideAction}>
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="planKey" value={planKey} />
        <input type="hidden" name="featureId" value={featureId} />
        <input type="hidden" name="included" value="false" />
        <Button type="submit" tone={override === false ? 'danger' : 'secondary'} size="small">
          Exclude
        </Button>
      </form>
      {override !== null ? (
        <form action={revokePlanFeatureOverrideAction}>
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="planKey" value={planKey} />
          <input type="hidden" name="featureId" value={featureId} />
          <Button type="submit" tone="secondary" size="small">
            Clear override
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function QuotaSheet({ planId, planKey, quota }: { planId: string; planKey: string; quota?: PlanQuota }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setPlanQuotaAction, ACTION_INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          {quota ? 'Edit' : 'Add quota'}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{quota ? `Edit ${quota.label}` : 'Add a structured quota'}</SheetTitle>
          <SheetDescription>Structured fields only — no free-text allowance.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="planKey" value={planKey} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="allowanceKey">Allowance key</FieldLabel>
            <TextInput id="allowanceKey" name="allowanceKey" required pattern="[a-z][a-z0-9_]{1,60}" defaultValue={quota?.allowanceKey} disabled={!!quota} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <TextInput id="label" name="label" required defaultValue={quota?.label} />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="unit">Unit</FieldLabel>
              <TextInput id="unit" name="unit" required defaultValue={quota?.unit} placeholder="token, minute, user" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="period">Period</FieldLabel>
              <SelectInput id="period" name="period" defaultValue={quota?.period ?? 'month'}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="none">None</option>
              </SelectInput>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="includedQuantity">Included</FieldLabel>
              <TextInput id="includedQuantity" name="includedQuantity" type="number" min={0} required defaultValue={quota?.includedQuantity} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="hardLimit">Hard limit</FieldLabel>
              <TextInput id="hardLimit" name="hardLimit" type="number" min={0} defaultValue={quota?.hardLimit ?? undefined} placeholder="No hard limit" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="overagePolicy">Overage policy</FieldLabel>
            <SelectInput id="overagePolicy" name="overagePolicy" defaultValue={quota?.overagePolicy ?? 'not_applicable'}>
              <option value="allowed">Allowed</option>
              <option value="blocked">Blocked</option>
              <option value="not_applicable">Not applicable</option>
            </SelectInput>
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function RemoveQuotaButton({ planId, planKey, allowanceKey }: { planId: string; planKey: string; allowanceKey: string }) {
  return (
    <form action={removePlanQuotaAction}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="planKey" value={planKey} />
      <input type="hidden" name="allowanceKey" value={allowanceKey} />
      <Button type="submit" tone="secondary" size="small">
        Remove
      </Button>
    </form>
  );
}

export function RecordPlanPriceSheet({ planId, planKey }: { planId: string; planKey: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPlanPriceAction, ACTION_INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">Record new price</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Record a standard price</SheetTitle>
          <SheetDescription>Appends a new effective-dated price. Past prices are never rewritten.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="planKey" value={planKey} />
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="currency">Currency</FieldLabel>
              <TextInput id="currency" name="currency" required maxLength={3} minLength={3} placeholder="EUR" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="amount">Amount</FieldLabel>
              <TextInput id="amount" name="amount" type="number" step="0.01" min={0} required placeholder="299.00" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="billingInterval">Cadence</FieldLabel>
            <SelectInput id="billingInterval" name="billingInterval" defaultValue="month">
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
              <option value="one_time">One-time</option>
            </SelectInput>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="effectiveFrom">Effective from</FieldLabel>
            <TextInput id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="source">Source</FieldLabel>
            <TextInput id="source" name="source" placeholder="Decided with the owner, 2026-09" />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Record price'}
            </Button>
            {state.updated ? <Hint role="status">Recorded.</Hint> : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
