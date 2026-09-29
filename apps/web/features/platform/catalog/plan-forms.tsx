'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/containers/page-drawer';
import { Section, SectionHeading } from '@/components/containers/section';
import { createPlanAction, type CreatePlanState } from '@/app/organizations/[organizationId]/platform/catalog/plans/actions';
import {
  grantPlanFeatureOverrideAction,
  grantPlanModuleAction,
  grantPlanProductAction,
  recordPlanPriceAction,
  recordPlanOverageRateAction,
  savePlanEconomicsSettingsAction,
  setPlanAddonAction,
  removePlanQuotaAction,
  revokePlanFeatureOverrideAction,
  revokePlanModuleAction,
  revokePlanProductAction,
  setPlanQuotaAction,
  updatePlanAction,
  type PlanActionState,
} from '@/app/organizations/[organizationId]/platform/catalog/plans/[planKey]/actions';
import type { Plan, PlanMarginPolicy, PlanQuota, PlanUtilizationAssumption } from '@/lib/domain/catalogue/plans';

const CREATE_INITIAL: CreatePlanState = { error: null };
const ACTION_INITIAL: PlanActionState = { error: null, updated: false };

export function CreatePlanSheet() {
  const [open, setOpen] = useState(false);
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
          <PageDrawerFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create'}
            </Button>
          </PageDrawerFooter>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function EditPlanSheet({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updatePlanAction, ACTION_INITIAL);

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
          <PageDrawerDescription>Key and kind are permanent.</PageDrawerDescription>
        </PageDrawerHeader>
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
          <PageDrawerFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </PageDrawerFooter>
        </form>
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
  const [state, action, pending] = useActionState(setPlanQuotaAction, ACTION_INITIAL);
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="allowanceType">Allowance type</FieldLabel>
              <SelectInput id="allowanceType" name="allowanceType" defaultValue={quota?.allowanceType ?? 'usage'}>
                <option value="usage">Usage</option><option value="capacity">Count / capacity</option><option value="recurring_resource">Recurring resource</option><option value="boolean">Boolean entitlement</option>
              </SelectInput>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="resetSemantics">Reset</FieldLabel>
              <SelectInput id="resetSemantics" name="resetSemantics" defaultValue={quota?.resetSemantics ?? 'billing_period'}>
                <option value="billing_period">Billing period</option><option value="calendar_period">Calendar period</option><option value="none">Does not reset</option>
              </SelectInput>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="meterId">Commercial meter</FieldLabel>
            <TextInput id="meterId" name="meterId" defaultValue={quota?.meterId ?? ''} placeholder="voice_minutes (optional)" />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="overageBehavior">Overage behavior</FieldLabel>
            <SelectInput id="overageBehavior" name="overageBehavior" value={overageBehavior} onChange={(event) => setOverageBehavior(event.target.value as PlanQuota['overageBehavior'])}>
              <option value="metered">Metered</option><option value="hard_limit">Hard limit</option><option value="soft_limit">Soft limit</option><option value="unmetered">Unmetered retail</option><option value="not_applicable">Not applicable</option>
            </SelectInput>
            <input type="hidden" name="overagePolicy" value={overageBehavior === 'metered' ? 'allowed' : overageBehavior === 'hard_limit' ? 'blocked' : 'not_applicable'} />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <PageDrawerFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </PageDrawerFooter>
        </form>
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

export function RecordPlanPriceSheet({ planId, planKey }: { planId: string; planKey: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPlanPriceAction, ACTION_INITIAL);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button">Record new price</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Record a standard price</PageDrawerTitle>
          <PageDrawerDescription>Appends a new effective-dated price. Past prices are never rewritten.</PageDrawerDescription>
        </PageDrawerHeader>
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
          <PageDrawerFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Record price'}
            </Button>
            {state.updated ? <Hint role="status">Recorded.</Hint> : null}
          </PageDrawerFooter>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function RecordOverageRateSheet({ planId, planKey, meterId, label, currency = 'CAD' }: { planId: string; planKey: string; meterId: string; label: string; currency?: string }) {
  const [state, action, pending] = useActionState(recordPlanOverageRateAction, ACTION_INITIAL);
  return <PageDrawer><PageDrawerTrigger asChild><Button type="button" tone="secondary" size="small">Add rate</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Record {label} overage rate</PageDrawerTitle><PageDrawerDescription>Appends a Plan-scoped effective version. Historical rates remain unchanged.</PageDrawerDescription></PageDrawerHeader><form action={action} className="flex flex-col gap-3 px-4"><input type="hidden" name="planId" value={planId} /><input type="hidden" name="planKey" value={planKey} /><input type="hidden" name="meterId" value={meterId} /><div className="grid grid-cols-[1fr_6rem] gap-3"><div className="grid gap-1"><FieldLabel htmlFor={`overage-amount-${meterId}`}>Rate per unit</FieldLabel><TextInput id={`overage-amount-${meterId}`} name="amount" type="number" min="0" step="0.0001" required /></div><div className="grid gap-1"><FieldLabel htmlFor={`overage-currency-${meterId}`}>Currency</FieldLabel><TextInput id={`overage-currency-${meterId}`} name="currency" defaultValue={currency} minLength={3} maxLength={3} required /></div></div><div className="grid gap-1"><FieldLabel htmlFor={`overage-effective-${meterId}`}>Effective from</FieldLabel><TextInput id={`overage-effective-${meterId}`} name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></div><div className="grid gap-1"><FieldLabel htmlFor={`overage-source-${meterId}`}>Source</FieldLabel><TextInput id={`overage-source-${meterId}`} name="source" required placeholder="Commercial decision" /></div><ErrorText>{state.error}</ErrorText>{state.updated ? <Hint>Rate recorded.</Hint> : null}<Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record rate'}</Button></form></PageDrawerContent></PageDrawer>;
}

export function PlanEconomicsSettingsSheet({ planId, planKey, currency, quotas, policy, assumptions }: { planId: string; planKey: string; currency: string; quotas: PlanQuota[]; policy: PlanMarginPolicy | null; assumptions: PlanUtilizationAssumption[] }) {
  const [state, action, pending] = useActionState(savePlanEconomicsSettingsAction, ACTION_INITIAL);
  const assumption = (scenario: string, key: string, fallback: number) => Math.round((assumptions.find((item) => item.scenario === scenario && item.allowanceKey === key)?.utilization ?? fallback) * 100);
  return <PageDrawer><PageDrawerTrigger asChild><Button type="button">Economics settings</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Economics settings</PageDrawerTitle><PageDrawerDescription>Versioned planning assumptions only; operational usage and provider costs are unchanged.</PageDrawerDescription></PageDrawerHeader><form action={action} className="flex flex-col gap-4 px-4"><input type="hidden" name="planId" value={planId} /><input type="hidden" name="planKey" value={planKey} /><input type="hidden" name="currency" value={currency} /><div className="grid grid-cols-3 gap-3"><div className="grid gap-1"><FieldLabel htmlFor="targetMargin">Target %</FieldLabel><TextInput id="targetMargin" name="targetMargin" type="number" min="1" max="99" step="0.1" defaultValue={(policy?.targetMargin ?? .7) * 100} required /></div><div className="grid gap-1"><FieldLabel htmlFor="warningMargin">Warning %</FieldLabel><TextInput id="warningMargin" name="warningMargin" type="number" min="0" max="99" step="0.1" defaultValue={(policy?.warningMargin ?? .6) * 100} required /></div><div className="grid gap-1"><FieldLabel htmlFor="hardFloorMargin">Floor %</FieldLabel><TextInput id="hardFloorMargin" name="hardFloorMargin" type="number" min="0" max="99" step="0.1" defaultValue={(policy?.hardFloorMargin ?? .45) * 100} required /></div></div><Section><SectionHeading>Utilization</SectionHeading><div className="mt-3 space-y-3">{quotas.map((quota) => <div key={quota.allowanceKey} className="grid grid-cols-[1fr_5rem_5rem] items-end gap-3"><p className="pb-2 text-sm">{quota.label}</p><div className="grid gap-1"><FieldLabel htmlFor={`expected-${quota.allowanceKey}`}>Expected</FieldLabel><TextInput id={`expected-${quota.allowanceKey}`} name={`utilization:expected:${quota.allowanceKey}`} type="number" min="0" max="100" defaultValue={assumption('expected', quota.allowanceKey, .5)} /></div><div className="grid gap-1"><FieldLabel htmlFor={`heavy-${quota.allowanceKey}`}>Heavy</FieldLabel><TextInput id={`heavy-${quota.allowanceKey}`} name={`utilization:heavy:${quota.allowanceKey}`} type="number" min="0" max="100" defaultValue={assumption('heavy', quota.allowanceKey, .8)} /></div></div>)}</div></Section><TextInput name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} aria-label="Effective from" /><TextInput name="source" required defaultValue="Staff planning assumption" aria-label="Source" /><ErrorText>{state.error}</ErrorText>{state.updated ? <Hint>New assumption versions recorded.</Hint> : null}<Button type="submit" disabled={pending} className="w-fit">{pending ? 'Saving…' : 'Save assumptions'}</Button></form></PageDrawerContent></PageDrawer>;
}

export function PlanAddonToggle({ planId, planKey, addonId, label, attached }: { planId: string; planKey: string; addonId: string; label: string; attached: boolean }) {
  return <form action={setPlanAddonAction} className="flex items-center justify-between gap-3 border-t border-border py-2"><input type="hidden" name="planId" value={planId} /><input type="hidden" name="planKey" value={planKey} /><input type="hidden" name="addonPlanId" value={addonId} /><input type="hidden" name="attached" value={String(!attached)} /><span className="text-sm">{label}</span><Button type="submit" tone="secondary" size="small">{attached ? 'Remove' : 'Add'}</Button></form>;
}
