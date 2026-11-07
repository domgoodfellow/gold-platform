'use client';

import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import {
  provisionTwilioAction,
  recordCommercialTermAction,
  recordPlanAssignmentAction,
  recordPlanAgreementAction,
  recordPlanQuotaOverrideAction,
  registerPhoneNumberAction,
  setResourceStatusAction,
  saveAsTemplateAction,
} from '@/app/platform/organizations/[targetOrganizationId]/actions';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/controls/confirm-submit';
import { FieldLabel, TextArea } from '@/components/controls/inputs';
import { SuggestionField } from '@/components/controls/select-field';
import { INDUSTRY_SUGGESTIONS } from '@/lib/domain/tenancy/industries';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  PLAN_ASSIGNMENT_INITIAL,
  PLAN_AGREEMENT_INITIAL,
  QUOTA_OVERRIDE_INITIAL,
  PROVISION_TWILIO_INITIAL,
  SAVE_TEMPLATE_INITIAL,
  REGISTER_RESOURCE_INITIAL,
  SET_RESOURCE_STATUS_INITIAL,
  TERM_INITIAL,
} from '@/app/platform/organizations/[targetOrganizationId]/action-states';
import { SelectField } from '@/components/controls/select-field';

type Option = { value: string; label: string };

export function ProvisionTwilioForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(provisionTwilioAction, PROVISION_TWILIO_INITIAL);
  return <form action={action} className="flex flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><ErrorText>{state.error}</ErrorText>{state.provisioned ? <p className="text-sm text-muted-foreground">Provisioned.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Provisioning…' : 'Provision Twilio subaccount'}</Button></form>;
}

export function RegisterPhoneNumberForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(registerPhoneNumberAction, REGISTER_RESOURCE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="number" required placeholder="+14165550142" aria-label="Phone number" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Register number'}</Button></form>;
}

export function SetResourceStatusForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(setResourceStatusAction, SET_RESOURCE_STATUS_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="resourceId" required placeholder="Resource ID" /><SelectField name="status" required aria-label="Status" options={[{ value: '', label: 'Status…' }, { value: 'active', label: 'Active / verified' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }, { value: 'disabled', label: 'Disabled' }]} /><TextInput name="errorDetail" placeholder="Error detail, if failed" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Update resource'}</Button></form>;
}

/** The base-Plan control: `kind=plan` only. An Add-on is a separate, stacking decision — see `ManageAddonsSheet`. */
export function AssignPlanSheet({ organizationId, plans }: { organizationId: string; plans: Option[] }) {
  const [state, action, pending] = useActionState(recordPlanAssignmentAction, PLAN_ASSIGNMENT_INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">
          Change Plan
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Assign a base Plan</PageDrawerTitle>
          <PageDrawerDescription>
            The base Plan determines entitlement. Available entitled features are active by default;
            the organization can switch them off. Provider-backed features may still need setup.
            A new assignment does not end an existing one on an overlapping period — end it first.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <SelectField name="planId" required aria-label="Plan" options={[{ value: '', label: 'Choose a Plan…' }, ...plans.map((plan) => ({ value: plan.value, label: plan.label }))]} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="periodStart" type="date" required aria-label="Period start" />
            <TextInput name="periodEnd" type="date" required aria-label="Period end" defaultValue="9999-12-31" />
          </div>
          <TextInput name="note" placeholder="Note (optional)" />
          <ErrorText role="alert">{state.error}</ErrorText>
          {state.recorded ? <Hint role="status">Assigned.</Hint> : null}
          <Button type="submit" size="small" className="w-fit" disabled={pending}>
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/**
 * The Add-on control: `kind=addon` only, stacking freely alongside the base Plan rather than
 * replacing it. Reuses `recordPlanAssignmentAction` — the same effective-dated write a base Plan
 * assignment uses, over the same `organization_plan_assignments` table; only the offered list of
 * Plans differs. There is currently no domain operation to end an Add-on assignment early — see
 * the History list for what is currently assigned.
 */
export function ManageAddonsSheet({ organizationId, addons }: { organizationId: string; addons: Option[] }) {
  const [state, action, pending] = useActionState(recordPlanAssignmentAction, PLAN_ASSIGNMENT_INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          Manage Add-ons
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Add an Add-on</PageDrawerTitle>
          <PageDrawerDescription>
            Add-ons stack alongside the base Plan rather than replacing it. Ending one early is not
            yet a supported operation here.
          </PageDrawerDescription>
        </PageDrawerHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <SelectField name="planId" required aria-label="Add-on" options={[{ value: '', label: 'Choose an Add-on…' }, ...addons.map((addon) => ({ value: addon.value, label: addon.label }))]} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="periodStart" type="date" required aria-label="Period start" />
            <TextInput name="periodEnd" type="date" required aria-label="Period end" defaultValue="9999-12-31" />
          </div>
          <TextInput name="note" placeholder="Note (optional)" />
          <ErrorText role="alert">{state.error}</ErrorText>
          {state.recorded ? <Hint role="status">Added.</Hint> : null}
          <Button type="submit" size="small" className="w-fit" disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function RecordCommercialTermForm({ organizationId, products }: { organizationId: string; products: Option[] }) {
  const [state, action, pending] = useActionState(recordCommercialTermAction, TERM_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><SelectField name="productKey" required aria-label="Product" options={[{ value: '', label: 'What was sold…' }, ...products.map((product) => ({ value: product.value, label: product.label }))]} /><div className="grid grid-cols-2 gap-2"><TextInput name="periodStart" type="date" required aria-label="Period start" /><TextInput name="periodEnd" type="date" required aria-label="Period end" /></div><div className="flex gap-2"><TextInput name="priceMinor" type="number" min={0} step={1} required placeholder="Minor units" /><TextInput name="currency" maxLength={3} placeholder="USD" className="w-24" /></div><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record term'}</Button></form>;
}

export function RecordPlanAgreementSheet({ organizationId, planId, planLabel, currency }: { organizationId: string; planId: string; planLabel: string; currency: string }) {
  const [state, action, pending] = useActionState(recordPlanAgreementAction, PLAN_AGREEMENT_INITIAL);
  return <PageDrawer><PageDrawerTrigger asChild><Button type="button" size="small">Edit agreement</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Record negotiated price</PageDrawerTitle><PageDrawerDescription>Appends an effective-dated agreement for {planLabel}; the Plan default remains unchanged.</PageDrawerDescription></PageDrawerHeader><form action={action} className="flex flex-col gap-3 px-4"><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="planId" value={planId} /><div className="grid grid-cols-[1fr_6rem] gap-3"><TextInput name="amount" type="number" min="0" step="0.01" required aria-label="Agreement price" placeholder="699.00" /><TextInput name="currency" defaultValue={currency} minLength={3} maxLength={3} required aria-label="Currency" /></div><div className="grid grid-cols-2 gap-3"><TextInput name="effectiveFrom" type="date" required aria-label="Effective from" /><TextInput name="effectiveTo" type="date" aria-label="Optional end date" /></div><TextInput name="note" placeholder="Commercial provenance" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <Hint>Agreement recorded.</Hint> : null}<Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record agreement'}</Button></form></PageDrawerContent></PageDrawer>;
}

export function RecordQuotaOverrideSheet({ organizationId, planId, quotas }: { organizationId: string; planId: string; quotas: Array<{ allowanceKey: string; label: string; includedQuantity: number }> }) {
  const [state, action, pending] = useActionState(recordPlanQuotaOverrideAction, QUOTA_OVERRIDE_INITIAL);
  return <PageDrawer><PageDrawerTrigger asChild><Button type="button" tone="secondary" size="small">Add allowance override</Button></PageDrawerTrigger><PageDrawerContent><PageDrawerHeader><PageDrawerTitle>Record allowance override</PageDrawerTitle><PageDrawerDescription>Appends an organization-specific value. The Plan default remains visible.</PageDrawerDescription></PageDrawerHeader><form action={action} className="flex flex-col gap-3 px-4"><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="planId" value={planId} /><SelectField name="allowanceKey" required aria-label="Allowance" options={[{ value: '', label: 'Choose allowance…' }, ...quotas.map((quota) => ({ value: quota.allowanceKey, label: `${quota.label} · Plan default ${quota.includedQuantity.toLocaleString()}` }))]} /><TextInput name="includedQuantity" type="number" min="0" required aria-label="Included quantity" /><TextInput name="hardLimit" type="number" min="0" aria-label="Hard limit" placeholder="No hard limit" /><TextInput name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} aria-label="Effective from" /><TextInput name="note" placeholder="Commercial provenance" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <Hint>Override recorded.</Hint> : null}<Button type="submit" disabled={pending} className="w-fit">{pending ? 'Recording…' : 'Record override'}</Button></form></PageDrawerContent></PageDrawer>;
}

/**
 * Save this business's setup as a starting template. It is saved unpublished: owners never see it
 * until it is published from Products. Its customers, jobs and money are never part of it.
 */
export function SaveTemplateDialog({ organizationId, businessName, industry }: { organizationId: string; businessName: string; industry: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previous: typeof SAVE_TEMPLATE_INITIAL, data: FormData) => {
    const result = await saveAsTemplateAction(previous, data);
    if (!result.error) {
      toast.success(`${result.saved} saved. Publish it from Products to offer it to new businesses.`);
      setOpen(false);
    }
    return result;
  }, SAVE_TEMPLATE_INITIAL);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" tone="secondary" size="small">Save as template</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save {businessName} as a template</DialogTitle>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-name">Name</FieldLabel>
            <TextInput id="template-name" name="name" required maxLength={120} defaultValue={businessName} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-category">Category</FieldLabel>
            <SuggestionField id="template-category" name="category" required maxLength={60} suggestions={INDUSTRY_SUGGESTIONS} defaultValue={industry ?? ''} />
            <Hint>A new owner who gives this industry has it chosen for them.</Hint>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-description">Description</FieldLabel>
            <TextArea id="template-description" name="description" required maxLength={300} rows={3} />
            <Hint>Owners read this when choosing a starting point.</Hint>
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save template'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
