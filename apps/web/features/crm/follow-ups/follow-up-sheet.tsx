'use client';
import { useActionState, useEffect, useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { PageDrawer, PageDrawerClose, PageDrawerContent, PageDrawerFooter, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger, usePageDrawerUnsavedChanges } from '@/components/panels/page-drawer';
import { saveFollowUpAction, searchFollowUpOpportunities, readFollowUpForDrawer } from '@/app/organizations/[organizationId]/crm/tasks/actions';
import { searchOpportunityCustomers } from '@/app/organizations/[organizationId]/crm/opportunities/actions';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import { SelectField } from '@/components/controls/select-field';
export type FollowUpOptions = { organizationId: string; timezone: string; members: { id: string; displayName: string }[]; mayManage: boolean };
type Props = FollowUpOptions & { item?: CrmTask; reference?: {id:string;title:string}; customer?: { id: string; name: string }; opportunity?: { id: string; title: string }; children?: ReactNode };
function localInput(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA',{ timeZone: timezone, year:'numeric', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(instant));
  const p = (key: string) => parts.find(part=>part.type===key)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
export function FollowUpSheet(props: Props) {
  const [open,setOpen] = useState(false);
  const [loaded,setLoaded]=useState<CrmTask|null>(null);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [pending,setPending]=useState(false);
  const formId=useId();
  const item=props.item??loaded??undefined;
  const showForm=open && (!props.reference || Boolean(item));
  // The same read-only rule as the form: no permission, or a follow-up that is no longer open.
  const editable=showForm && props.mayManage && (!item || item.status==='open');
  const changeOpen=(next:boolean)=>{
    setOpen(next);
    if(next && props.reference){setLoaded(null);setLoadError(null);void readFollowUpForDrawer(props.organizationId,props.reference.id).then(result=>{setLoaded(result);if(!result)setLoadError('This follow-up is no longer available.');}).catch(()=>setLoadError('Follow-up could not be loaded. Close and try again.'));}
  };
  return <PageDrawer open={open} onOpenChange={changeOpen}>
    <PageDrawerTrigger asChild><Button tone={props.item || props.reference ? 'text' : 'primary'} className={props.children || props.reference ? 'h-auto justify-start whitespace-normal p-0 text-left' : undefined}>{props.children ?? props.reference?.title ?? (props.item ? 'Edit follow-up' : 'New follow-up')}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{item ? props.mayManage && item.status==='open' ? 'Edit follow-up' : 'Follow-up' : props.reference?'Follow-up':'New follow-up'}</PageDrawerTitle></PageDrawerHeader>
      {showForm ? <FollowUpForm {...props} item={item} formId={formId} onSaved={()=>setOpen(false)} onPendingChange={setPending} /> : <div><p role="status">{loadError??'Loading follow-up…'}</p></div>}
      {/* A read-only follow-up keeps only the drawer's own close control, as before. */}
      {editable ? <PageDrawerFooter>
        <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save follow-up'}</Button>
        <PageDrawerClose asChild><Button type="button" tone="secondary">Cancel</Button></PageDrawerClose>
      </PageDrawerFooter> : null}
    </PageDrawerContent>
  </PageDrawer>;
}
function FollowUpForm({ organizationId, timezone, members, mayManage, item, customer, opportunity, formId, onSaved, onPendingChange }: Props & { formId: string; onSaved: ()=>void; onPendingChange: (pending: boolean)=>void }) {
  const prefix=useId(); const router=useRouter();
  const [state,action,pending]=useActionState(saveFollowUpAction,{error:null,savedId:null});
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(action, state, pending, onPendingChange);
  const fixed=customer ?? (item ? { id:item.customerId,name:item.customerName } : undefined);
  const [customerId,setCustomerId]=useState(fixed?.id ?? '');
  const [opportunityId,setOpportunityId]=useState(opportunity?.id ?? item?.opportunityId ?? '');
  const [search,setSearch]=useState('');
  const customerIsFixed=Boolean(fixed);
  const [customers,setCustomers]=useState<{ id:string;name:string }[]>([]);
  const [opportunities,setOpportunities]=useState<{ id:string;title:string }[]>([]);
  const [loadError,setLoadError]=useState<string|null>(null);
  const readonly=!mayManage || (item && item.status!=='open');
  useEffect(()=>{ if(customerIsFixed) return; let active=true; const timer=setTimeout(()=>{void searchOpportunityCustomers(organizationId,search).then(result=>{if(active)setCustomers(result.customers);}).catch(()=>{if(active)setLoadError('Customers could not be loaded.');});},200); return()=>{active=false;clearTimeout(timer);}; },[organizationId,search,customerIsFixed]);
  useEffect(()=>{let active=true; void searchFollowUpOpportunities(organizationId,customerId).then(result=>{if(active)setOpportunities(result);}).catch(()=>{if(active)setLoadError('Opportunities could not be loaded.');}); return()=>{active=false;};},[organizationId,customerId]);
  useEffect(()=>{if(state.savedId){onSaved();router.refresh();}},[state.savedId,onSaved,router]);
  return <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="space-y-4">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="id" value={item?.id ?? ''}/>
    {fixed ? <><input type="hidden" name="customerId" value={fixed.id}/><p className="text-sm">Customer: <strong>{fixed.name}</strong></p></> : <>
      <FormField id={`${prefix}-search`} label="Find customer">{p=><TextInput {...p} type="search" value={search} onChange={e=>setSearch(e.target.value)}/>}</FormField>
      <FormField id={`${prefix}-customer`} label="Customer">{p=><SelectField {...p} name="customerId" required value={customerId} onValueChange={(next) => {setCustomerId(next);setOpportunityId('');}} options={[{ value: '', label: 'Choose a customer' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />}</FormField>
    </>}
    <fieldset disabled={Boolean(readonly)} className="space-y-4">
      <FormField id={`${prefix}-opportunity`} label="Opportunity" optional>{p=><SelectField {...p} name="opportunityId" value={opportunityId} onValueChange={(next) => setOpportunityId(next)} options={[{ value: '', label: 'Customer only' }, ...opportunities.map((o) => ({ value: o.id, label: o.title ?? '' })), ...(opportunityId && !opportunities.some(o=>o.id===opportunityId) ? [{ value: opportunityId, label: opportunity?.title ?? item?.opportunityTitle ?? '' }] : [])]} />}</FormField>
      <FormField id={`${prefix}-kind`} label="Type">{p=><SelectField {...p} name="kind" defaultValue={item?.kind ?? 'task'} options={[...['call','email','meeting','task'].map((k) => ({ value: k, label: k }))]} />}</FormField>
      <FormField id={`${prefix}-title`} label="Title">{p=><TextInput {...p} name="title" required maxLength={200} defaultValue={item?.title}/>}</FormField>
      <FormField id={`${prefix}-due`} label="Due" hint={timezone}>{p=><TextInput {...p} name="dueAt" required type="datetime-local" defaultValue={item ? localInput(item.dueAt,timezone) : undefined}/>}</FormField>
      <FormField id={`${prefix}-owner`} label="Owner" optional>{p=><SelectField {...p} name="ownerMembershipId" defaultValue={item?.ownerMembershipId ?? ''} options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.displayName }))]} />}</FormField>
      <FormField id={`${prefix}-notes`} label="Notes" optional>{p=><textarea {...p} name="notes" maxLength={10000} defaultValue={item?.notes ?? ''} className="w-full rounded-md border border-border bg-background p-2" rows={4}/>}</FormField>
    </fieldset>
    {item ? <p className="text-sm capitalize text-muted">{item.status}{item.completedAt ? ` · ${new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.completedAt))}` : ''}</p> : null}
    <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error ?? loadError}</FormError></div>
  </form>;
}
