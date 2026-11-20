'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { createPlanAction, type CreatePlanState } from '@/app/platform/catalog/plans/actions';
import {
  grantPlanFeatureOverrideAction,
  grantPlanModuleAction,
  grantPlanProductAction,
  removePlanQuotaAction,
  revokePlanFeatureOverrideAction,
  revokePlanModuleAction,
  revokePlanProductAction,
  setPlanQuotaAction,
  updatePlanSwitchesAction,
  type PlanActionState,
} from '@/app/platform/catalog/plans/[planKey]/actions';
import type { Plan, PlanQuota } from '@/lib/domain/catalogue/plans';
import { SelectField } from '@/components/controls/select-field';

const CREATE_INITIAL: CreatePlanState = { error: null };
const ACTION_INITIAL: PlanActionState = { error: null, updated: false };

/** A saved drawer closes and says so in a toast, the shared feedback after an action. */
function useSavedFeedback(state: PlanActionState, close: () => void, message: string) {
  useEffect(() => {
    if (!state.updated) return;
    toast.success(message);
    close();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function CreatePlanSheet() {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [state, action, pending] = useActionState(createPlanAction, CREATE_INITIAL);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">Create Plan</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Create a Plan or Add-on</PageDrawerTitle>
          <PageDrawerDescription>The key is permanent once created.</PageDrawerDescription>
        </PageDrawerHeader>
        <form id={formId} action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="key">Key</FieldLabel>
            <TextInput id="key" name="key" required pattern="[a-z][a-z0-9_]{1,60}" placeholder="growth" />
            <Hint weight="subtle">Lowercase letters, numbers and underscores only.</Hint>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="kind">Kind</FieldLabel>
            <SelectField id="kind" name="kind" defaultValue="plan" options={[{ value: 'plan', label: 'Plan (one base package per organization)' }, { value: 'addon', label: 'Add-on (stacks alongside a Plan)' }]} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <TextInput id="label" name="label" required maxLength={120} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billable" defaultChecked /> Billable
          </label>
          <ErrorText role="alert">{state.error}</ErrorText>
        </form>
        <PageDrawerFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function EditPlanSwitchesSheet({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [state, action, pending] = useActionState(updatePlanSwitchesAction, ACTION_INITIAL);
  useSavedFeedback(state, () => setOpen(false), 'Plan saved.');

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          Edit
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Edit {plan.label}</PageDrawerTitle>
        </PageDrawerHeader>
        <form id={formId} action={action} className="flex flex-col gap-3">
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="planKey" value={plan.key} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billable" defaultChecked={plan.billable} /> Billed
          </label>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="displayOrder">Order in the registry</FieldLabel>
            <TextInput id="displayOrder" name="displayOrder" type="number" min={0} defaultValue={plan.displayOrder} className="w-28" />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
        </form>
        <PageDrawerFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
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
  const formId = useId();
  const [state, action, pending] = useActionState(setPlanQuotaAction, ACTION_INITIAL);
  useSavedFeedback(state, () => setOpen(false), 'Allowance saved.');
  const [overageBehavior, setOverageBehavior] = useState(quota?.overageBehavior ?? 'not_applicable');

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          {quota ? 'Edit' : 'Add quota'}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{quota ? `Edit ${quota.label}` : 'Add a structured quota'}</PageDrawerTitle>
          <PageDrawerDescription>Structured fields only — no free-text allowance.</PageDrawerDescription>
        </PageDrawerHeader>
        <form id={formId} action={action} className="flex flex-col gap-3">
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
              <SelectField id="period" name="period" defaultValue={quota?.period ?? 'month'} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'none', label: 'None' }]} />
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="allowanceType">Allowance type</FieldLabel>
              <SelectField id="allowanceType" name="allowanceType" defaultValue={quota?.allowanceType ?? 'usage'} options={[{ value: 'usage', label: 'Usage' }, { value: 'capacity', label: 'Count / capacity' }, { value: 'recurring_resource', label: 'Recurring resource' }, { value: 'boolean', label: 'Boolean entitlement' }]} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="resetSemantics">Reset</FieldLabel>
              <SelectField id="resetSemantics" name="resetSemantics" defaultValue={quota?.resetSemantics ?? 'billing_period'} options={[{ value: 'billing_period', label: 'Billing period' }, { value: 'calendar_period', label: 'Calendar period' }, { value: 'none', label: 'Does not reset' }]} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="meterId">Commercial meter</FieldLabel>
            <TextInput id="meterId" name="meterId" defaultValue={quota?.meterId ?? ''} placeholder="voice_minutes (optional)" />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="overageBehavior">Overage behavior</FieldLabel>
            <SelectField id="overageBehavior" name="overageBehavior" value={overageBehavior} onValueChange={(next) => setOverageBehavior(next as PlanQuota['overageBehavior'])} options={[{ value: 'metered', label: 'Metered' }, { value: 'hard_limit', label: 'Hard limit' }, { value: 'soft_limit', label: 'Soft limit' }, { value: 'unmetered', label: 'Unmetered retail' }, { value: 'not_applicable', label: 'Not applicable' }]} />
            <input type="hidden" name="overagePolicy" value={overageBehavior === 'metered' ? 'allowed' : overageBehavior === 'hard_limit' ? 'blocked' : 'not_applicable'} />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
        </form>
        <PageDrawerFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
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
