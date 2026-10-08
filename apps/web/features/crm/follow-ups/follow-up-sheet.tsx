'use client';
import { useActionState, useEffect, useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormField, FormError } from '@/components/controls/form';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { saveFollowUpAction, searchFollowUpOpportunities, readFollowUpForDrawer } from '@/app/organizations/[organizationId]/follow-ups/actions';
import { searchOpportunityCustomers } from '@/app/organizations/[organizationId]/opportunities/actions';
import type { FollowUp } from '@/lib/domain/follow-ups/follow-ups';
export type FollowUpOptions = { organizationId: string; timezone: string; members: { id: string; displayName: string }[]; mayManage: boolean };
type Props = FollowUpOptions & { item?: FollowUp; reference?: {id:string;title:string}; customer?: { id: string; name: string }; opportunity?: { id: string; title: string }; children?: ReactNode };
function localInput(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA',{ timeZone: timezone, year:'numeric', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(instant));
  const p = (key: string) => parts.find(part=>part.type===key)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
export function FollowUpSheet(props: Props) {
  const [open,setOpen] = useState(false);
  const [loaded,setLoaded]=useState<FollowUp|null>(null);
  const [loadError,setLoadError]=useState<string|null>(null);
  const item=props.item??loaded??undefined;
  const changeOpen=(next:boolean)=>{
    setOpen(next);
    if(next && props.reference){setLoaded(null);setLoadError(null);void readFollowUpForDrawer(props.organizationId,props.reference.id).then(result=>{setLoaded(result);if(!result)setLoadError('This follow-up is no longer available.');}).catch(()=>setLoadError('Follow-up could not be loaded. Close and try again.'));}
  };
  return <PageDrawer open={open} onOpenChange={changeOpen}>
    <PageDrawerTrigger asChild><Button tone={props.item || props.reference ? 'text' : 'primary'} className={props.children || props.reference ? 'h-auto justify-start whitespace-normal p-0 text-left' : undefined}>{props.children ?? props.reference?.title ?? (props.item ? 'Edit follow-up' : 'New follow-up')}</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>{item ? props.mayManage && item.status==='open' ? 'Edit follow-up' : 'Follow-up' : props.reference?'Follow-up':'New follow-up'}</PageDrawerTitle></PageDrawerHeader>
      {open && (!props.reference || item) ? <FollowUpForm {...props} item={item} onSaved={()=>setOpen(false)} /> : <div><p role="status">{loadError??'Loading follow-up…'}</p></div>}
    </PageDrawerContent>
  </PageDrawer>;
}
function FollowUpForm({ organizationId, timezone, members, mayManage, item, customer, opportunity, onSaved }: Props & { onSaved: ()=>void }) {
  const prefix=useId(); const router=useRouter();
  const [state,action,pending]=useActionState(saveFollowUpAction,{error:null,savedId:null});
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
  return <form action={action} className="space-y-4">
    <input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="id" value={item?.id ?? ''}/>
    {fixed ? <><input type="hidden" name="customerId" value={fixed.id}/><p className="text-sm">Customer: <strong>{fixed.name}</strong></p></> : <>
      <FormField id={`${prefix}-search`} label="Find customer">{p=><TextInput {...p} type="search" value={search} onChange={e=>setSearch(e.target.value)}/>}</FormField>
      <FormField id={`${prefix}-customer`} label="Customer">{p=><SelectInput {...p} name="customerId" required value={customerId} onChange={e=>{setCustomerId(e.target.value);setOpportunityId('');}}><option value="">Choose a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput>}</FormField>
    </>}
    <fieldset disabled={Boolean(readonly)} className="space-y-4">
      <FormField id={`${prefix}-opportunity`} label="Opportunity" optional>{p=><SelectInput {...p} name="opportunityId" value={opportunityId} onChange={e=>setOpportunityId(e.target.value)}><option value="">Customer only</option>{opportunities.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}{opportunityId && !opportunities.some(o=>o.id===opportunityId) ? <option value={opportunityId}>{opportunity?.title ?? item?.opportunityTitle}</option> : null}</SelectInput>}</FormField>
      <FormField id={`${prefix}-kind`} label="Type">{p=><SelectInput {...p} name="kind" defaultValue={item?.kind ?? 'task'}>{['call','email','meeting','task'].map(k=><option key={k} value={k}>{k}</option>)}</SelectInput>}</FormField>
      <FormField id={`${prefix}-title`} label="Title">{p=><TextInput {...p} name="title" required maxLength={200} defaultValue={item?.title}/>}</FormField>
      <FormField id={`${prefix}-due`} label="Due" hint={timezone}>{p=><TextInput {...p} name="dueAt" required type="datetime-local" defaultValue={item ? localInput(item.dueAt,timezone) : undefined}/>}</FormField>
      <FormField id={`${prefix}-owner`} label="Owner" optional>{p=><SelectInput {...p} name="ownerMembershipId" defaultValue={item?.ownerMembershipId ?? ''}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</SelectInput>}</FormField>
      <FormField id={`${prefix}-notes`} label="Notes" optional>{p=><textarea {...p} name="notes" maxLength={10000} defaultValue={item?.notes ?? ''} className="w-full rounded-md border border-border bg-background p-2" rows={4}/>}</FormField>
    </fieldset>
    {item ? <p className="text-sm capitalize text-muted">{item.status}{item.completedAt ? ` · ${new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.completedAt))}` : ''}</p> : null}
    <FormError>{state.error ?? loadError}</FormError>{!readonly ? <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save follow-up'}</Button> : null}
  </form>;
}
