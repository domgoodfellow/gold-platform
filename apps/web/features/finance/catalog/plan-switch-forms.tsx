'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
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
} from '@/app/organizations/[organizationId]/finance/catalog/plan-switch-actions';
import type { Plan, PlanQuota } from '@/lib/domain/catalogue/plans';

/** The Finance record a switch belongs to: the business selling it, the item selling it and the plan it switches. */
export type PlanTarget = { organizationId: string; itemId: string; planId: string };
import { SelectField } from '@/components/controls/select-field';

const ACTION_INITIAL: PlanActionState = { error: null, updated: false };

function TargetFields({ target }: { target: PlanTarget }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={target.organizationId} />
      <input type="hidden" name="itemId" value={target.itemId} />
      <input type="hidden" name="planId" value={target.planId} />
    </>
  );
}

/** A saved drawer closes and says so in a toast, the shared feedback after an action. */
function useSavedFeedback(state: PlanActionState, close: () => void, message: string) {
  useEffect(() => {
    if (!state.updated) return;
    toast.success(message);
    close();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function EditPlanSwitchesSheet({ target, plan }: { target: PlanTarget; plan: Plan }) {
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
          <TargetFields target={target} />
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

export function ProductGrantToggle({ target, productKey, granted }: { target: PlanTarget; productKey: string; granted: boolean }) {
  const action = granted ? revokePlanProductAction : grantPlanProductAction;
  return (
    <form action={action}>
      <TargetFields target={target} />
      <input type="hidden" name="productKey" value={productKey} />
      <Button type="submit" tone={granted ? 'secondary' : 'primary'} size="small">
        {granted ? 'Remove whole Product' : 'Include all available Features'}
      </Button>
    </form>
  );
}

export function ModuleGrantToggle({ target, moduleId, granted }: { target: PlanTarget; moduleId: string; granted: boolean }) {
  const action = granted ? revokePlanModuleAction : grantPlanModuleAction;
  return (
    <form action={action}>
      <TargetFields target={target} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <Button type="submit" tone={granted ? 'secondary' : 'primary'} size="small">
        {granted ? 'Remove group' : 'Include group'}
      </Button>
    </form>
  );
}

export function FeatureOverrideControl({
  target,
  featureId,
  override,
}: {
  target: PlanTarget;
  featureId: string;
  override: boolean | null; // null = no override, true/false = explicit override
}) {
  return (
    <div className="flex items-center gap-1">
      <form action={grantPlanFeatureOverrideAction}>
        <TargetFields target={target} />
        <input type="hidden" name="featureId" value={featureId} />
        <input type="hidden" name="included" value="true" />
        <Button type="submit" tone={override === true ? 'primary' : 'secondary'} size="small">
          Include
        </Button>
      </form>
      <form action={grantPlanFeatureOverrideAction}>
        <TargetFields target={target} />
        <input type="hidden" name="featureId" value={featureId} />
        <input type="hidden" name="included" value="false" />
        <Button type="submit" tone={override === false ? 'danger' : 'secondary'} size="small">
          Exclude
        </Button>
      </form>
      {override !== null ? (
        <form action={revokePlanFeatureOverrideAction}>
          <TargetFields target={target} />
          <input type="hidden" name="featureId" value={featureId} />
          <Button type="submit" tone="secondary" size="small">
            Clear override
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function QuotaSheet({ target, quota }: { target: PlanTarget; quota?: PlanQuota }) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [state, action, pending] = useActionState(setPlanQuotaAction, ACTION_INITIAL);
  useSavedFeedback(state, () => setOpen(false), 'Allowance saved.');
  const [overageBehavior, setOverageBehavior] = useState(quota?.overageBehavior ?? 'not_applicable');

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          {quota ? 'Edit' : 'Add allowance'}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{quota ? `Edit ${quota.label}` : 'Add an allowance'}</PageDrawerTitle>
        </PageDrawerHeader>
        <form id={formId} action={action} className="flex flex-col gap-3">
          <TargetFields target={target} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="allowanceKey">Allowance key</FieldLabel>
            <TextInput id="allowanceKey" name="allowanceKey" required pattern="[a-z][a-z0-9_]{1,60}" defaultValue={quota?.allowanceKey} readOnly={!!quota} />
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
              <SelectField id="allowanceType" name="allowanceType" defaultValue={quota?.allowanceType ?? 'usage'} options={[{ value: 'usage', label: 'Usage' }, { value: 'capacity', label: 'Count / capacity' }, { value: 'recurring_resource', label: 'Recurring resource' }, { value: 'boolean', label: 'On or off' }]} />
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

export function RemoveQuotaButton({ target, allowanceKey }: { target: PlanTarget; allowanceKey: string }) {
  return (
    <form action={removePlanQuotaAction}>
      <TargetFields target={target} />
      <input type="hidden" name="allowanceKey" value={allowanceKey} />
      <Button type="submit" tone="secondary" size="small">
        Remove
      </Button>
    </form>
  );
}
