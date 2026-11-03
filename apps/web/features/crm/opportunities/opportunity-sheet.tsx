'use client';

import { useActionState, useEffect, useId, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ButtonTone } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { FormField, FormError } from '@/components/controls/form';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { saveOpportunityAction, searchOpportunityCustomers } from '@/app/organizations/[organizationId]/crm/opportunities/actions';
import type { Opportunity, OpportunityStage } from '@/lib/domain/opportunities/opportunities';
import { opportunityValueInput } from '@/lib/domain/opportunities/money';

type CustomerChoice = { id: string; name: string };
export type OpportunityFormOptions = { organizationId: string; stages: OpportunityStage[]; members: { id: string; displayName: string }[]; defaultCurrency: string };
/**
 * Create or edit an opportunity in a focused dialog: one short form, its single primary action, and
 * the shared unsaved-change protection. Saving still opens the saved opportunity.
 */
export function OpportunitySheet({ opportunity, customer, triggerTone, ...options }: OpportunityFormOptions & { opportunity?: Opportunity; customer?: CustomerChoice; triggerTone?: ButtonTone }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();
  const title = opportunity ? 'Edit opportunity' : 'New opportunity';
  return <>
    <Button type="button" tone={triggerTone ?? (opportunity ? 'secondary' : 'primary')} onClick={() => setOpen(true)}>{title}</Button>
    <GuardedDialog open={open} onOpenChange={setOpen}>
      <StepHeader title={title} />
      <DialogBody><OpportunityForm {...options} opportunity={opportunity} customer={customer} formId={formId} onSaved={() => setOpen(false)} onPendingChange={setPending} /></DialogBody>
      <DialogFooterBar>
        <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save opportunity'}</Button>
        <CancelButton />
      </DialogFooterBar>
    </GuardedDialog>
  </>;
}
function CancelButton() {
  const close = useGuardedDialogClose();
  return <Button type="button" tone="secondary" onClick={close}>Cancel</Button>;
}
function OpportunityForm({ organizationId, stages, members, defaultCurrency, opportunity, customer, formId, onSaved, onPendingChange }: OpportunityFormOptions & { opportunity?: Opportunity; customer?: CustomerChoice; formId: string; onSaved: () => void; onPendingChange: (pending: boolean) => void }) {
  const prefix = useId();
  const router = useRouter();
  const [state, action, pending] = useActionState(saveOpportunityAction, { error: null, savedId: null });
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(action, state, pending, onPendingChange);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<{ customers: CustomerChoice[]; total: number }>({ customers: [], total: 0 });
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const fixedCustomer = customer ?? (opportunity ? { id: opportunity.customerId, name: opportunity.customerName } : undefined);
  const customerIsFixed = Boolean(customer || opportunity);
  const [draft, setDraft] = useState<Record<string, string>>({ customerId: fixedCustomer?.id ?? '', title: opportunity?.title ?? '', stageId: opportunity?.stageId ?? '', value: opportunityValueInput(opportunity?.amountMinor ?? null, opportunity?.currency ?? defaultCurrency), currency: opportunity?.currency ?? defaultCurrency, ownerMembershipId: opportunity?.ownerMembershipId ?? '', expectedCloseOn: opportunity?.expectedCloseOn ?? '' });
  useEffect(() => {
    if (customerIsFixed) return;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchOpportunityCustomers(organizationId, search).then((value) => {
        if (active) { setResult(value); setSearchError(null); }
      }).catch(() => { if (active) setSearchError('Contacts could not be loaded. Try searching again.'); }).finally(() => { if (active) setSearching(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, search, customerIsFixed]);
  useEffect(() => {
    // Navigate first, then close: the opportunity page is dynamic, so it loads fresh without a refresh that could override the push.
    if (state.savedId) { router.push(`/organizations/${organizationId}/crm/opportunities/${state.savedId}`); onSaved(); }
  }, [state.savedId, onSaved, router, organizationId]);
  const changeDraft = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  };
  return <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="space-y-4">
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="opportunityId" value={opportunity?.id ?? ''} />
    {fixedCustomer ? <><input type="hidden" name="customerId" value={fixedCustomer.id} /><p className="text-sm">Contact: <strong>{fixedCustomer.name}</strong></p></> : <>
      <FormField id={`${prefix}-search`} label="Find contact" hint="Search by name, email or phone.">{(props) => <TextInput {...props} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />}</FormField>
      <FormField id={`${prefix}-customer`} label="Contact">{(props) => <SelectField {...props} name="customerId" required value={draft.customerId} onValueChange={(next) => setDraft((current) => ({ ...current, customerId: next }))} options={[{ value: '', label: 'Choose a contact' }, ...result.customers.map((entry) => ({ value: entry.id, label: entry.name }))]} />}</FormField>
      <p role="status" className="text-xs text-muted">{searching ? 'Searching…' : result.total > result.customers.length ? `Showing ${result.customers.length} of ${result.total}. Refine your search.` : `${result.total} contacts found.`}</p>
      <FormError>{searchError}</FormError>
    </>}
    <FormField id={`${prefix}-title`} label="Title">{(props) => <TextInput {...props} name="title" required maxLength={200} value={draft.title} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-stage`} label="Opportunity stage" optional>{(props) => <SelectField {...props} name="stageId" value={draft.stageId} onValueChange={(next) => setDraft((current) => ({ ...current, stageId: next }))} options={[{ value: '', label: 'Unstaged' }, ...stages.map((stage) => ({ value: stage.id, label: `${stage.name} (${stage.kind})` }))]} />}</FormField>
    <FormField id={`${prefix}-value`} label="Value" optional>{(props) => <TextInput {...props} name="value" inputMode="decimal" value={draft.value} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-currency`} label="Currency" hint="Three-letter currency code. Required when a value is entered.">{(props) => <TextInput {...props} name="currency" maxLength={3} value={draft.currency} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-owner`} label="Owner" optional>{(props) => <SelectField {...props} name="ownerMembershipId" value={draft.ownerMembershipId} onValueChange={(next) => setDraft((current) => ({ ...current, ownerMembershipId: next }))} options={[{ value: '', label: 'Unassigned' }, ...members.map((member) => ({ value: member.id, label: member.displayName || 'Member' }))]} />}</FormField>
    <FormField id={`${prefix}-date`} label="Expected close" optional>{(props) => <TextInput {...props} name="expectedCloseOn" type="date" value={draft.expectedCloseOn} onChange={changeDraft} />}</FormField>
    <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
  </form>;
}
