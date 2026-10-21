'use client';

import { useActionState, useEffect, useId, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { PageDrawer, PageDrawerClose, PageDrawerContent, PageDrawerFooter, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger, usePageDrawerUnsavedChanges } from '@/components/panels/page-drawer';
import { saveOpportunityAction, searchOpportunityCustomers } from '@/app/organizations/[organizationId]/opportunities/actions';
import type { Opportunity, OpportunityStage } from '@/lib/domain/opportunities/opportunities';
import { opportunityValueInput } from '@/lib/domain/opportunities/money';

type CustomerChoice = { id: string; name: string };
export type OpportunityFormOptions = { organizationId: string; stages: OpportunityStage[]; members: { id: string; displayName: string }[]; defaultCurrency: string };
export function OpportunitySheet({ opportunity, customer, ...options }: OpportunityFormOptions & { opportunity?: Opportunity; customer?: CustomerChoice }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button tone={opportunity ? 'secondary' : 'primary'}>{opportunity ? 'Edit opportunity' : 'New opportunity'}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{opportunity ? 'Edit opportunity' : 'New opportunity'}</PageDrawerTitle></PageDrawerHeader>
      <OpportunityForm {...options} opportunity={opportunity} customer={customer} formId={formId} onSaved={() => setOpen(false)} onPendingChange={setPending} />
      <PageDrawerFooter>
        <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save opportunity'}</Button>
        <PageDrawerClose asChild><Button type="button" tone="secondary">Cancel</Button></PageDrawerClose>
      </PageDrawerFooter>
    </PageDrawerContent>
  </PageDrawer>;
}
function OpportunityForm({ organizationId, stages, members, defaultCurrency, opportunity, customer, formId, onSaved, onPendingChange }: OpportunityFormOptions & { opportunity?: Opportunity; customer?: CustomerChoice; formId: string; onSaved: () => void; onPendingChange: (pending: boolean) => void }) {
  const prefix = useId();
  const router = useRouter();
  const [state, action, pending] = useActionState(saveOpportunityAction, { error: null, savedId: null });
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
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
      }).catch(() => { if (active) setSearchError('Customers could not be loaded. Try searching again.'); }).finally(() => { if (active) setSearching(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, search, customerIsFixed]);
  useEffect(() => {
    if (state.savedId) { onSaved(); router.push(`/organizations/${organizationId}/opportunities/${state.savedId}`); router.refresh(); }
  }, [state.savedId, onSaved, router, organizationId]);
  const changeDraft = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  };
  return <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="space-y-4">
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="opportunityId" value={opportunity?.id ?? ''} />
    {fixedCustomer ? <><input type="hidden" name="customerId" value={fixedCustomer.id} /><p className="text-sm">Customer: <strong>{fixedCustomer.name}</strong></p></> : <>
      <FormField id={`${prefix}-search`} label="Find customer" hint="Search by name, email or phone.">{(props) => <TextInput {...props} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />}</FormField>
      <FormField id={`${prefix}-customer`} label="Customer">{(props) => <SelectInput {...props} name="customerId" required value={draft.customerId} onChange={changeDraft}><option value="">Choose a customer</option>{result.customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</SelectInput>}</FormField>
      <p role="status" className="text-xs text-muted">{searching ? 'Searching…' : result.total > result.customers.length ? `Showing ${result.customers.length} of ${result.total}. Refine your search.` : `${result.total} customers found.`}</p>
      <FormError>{searchError}</FormError>
    </>}
    <FormField id={`${prefix}-title`} label="Title">{(props) => <TextInput {...props} name="title" required maxLength={200} value={draft.title} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-stage`} label="Opportunity stage" optional>{(props) => <SelectInput {...props} name="stageId" value={draft.stageId} onChange={changeDraft}><option value="">Unstaged</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name} ({stage.kind})</option>)}</SelectInput>}</FormField>
    <FormField id={`${prefix}-value`} label="Value" optional>{(props) => <TextInput {...props} name="value" inputMode="decimal" value={draft.value} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-currency`} label="Currency" hint="Three-letter currency code. Required when a value is entered.">{(props) => <TextInput {...props} name="currency" maxLength={3} value={draft.currency} onChange={changeDraft} />}</FormField>
    <FormField id={`${prefix}-owner`} label="Owner" optional>{(props) => <SelectInput {...props} name="ownerMembershipId" value={draft.ownerMembershipId} onChange={changeDraft}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName || 'Member'}</option>)}</SelectInput>}</FormField>
    <FormField id={`${prefix}-date`} label="Expected close" optional>{(props) => <TextInput {...props} name="expectedCloseOn" type="date" value={draft.expectedCloseOn} onChange={changeDraft} />}</FormField>
    <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
  </form>;
}
