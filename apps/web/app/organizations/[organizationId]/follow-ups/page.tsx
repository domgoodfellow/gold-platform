import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput,SelectInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import { listFollowUps,type FollowUpKind,type FollowUpStatus } from '@/lib/domain/follow-ups/follow-ups';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { followUpsAvailable,dueFilter } from '@/lib/application/crm/follow-ups';
import { workspaceAncestry } from '@/lib/navigation';
import { listCustomers,getCustomer } from '@/lib/domain/customers/customers';
import { listOpportunities,getOpportunity } from '@/lib/domain/opportunities/opportunities';
import { zonedDayRange,shiftDate } from '@/lib/domain/scheduling/window';
export const dynamic='force-dynamic';
export default async function FollowUpsPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {organizationId}=await params; const q=await searchParams;
  const {db,organization}=await requireOrganization(organizationId);
  if(!await followUpsAvailable(db,organizationId))notFound();
  const status=['open','completed','cancelled'].includes(q.status??'')?q.status as FollowUpStatus:q.status==='all'?undefined:'open';
  const kind=['call','email','meeting','task'].includes(q.kind??'')?q.kind as FollowUpKind:undefined;
  const page=Math.max(1,parseInt(q.page??'',10)||1);
  const isDate=(raw:string|undefined):raw is string=>Boolean(raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0,10)===raw);
  const bounds=dueFilter(q.due??'',organization.timezone);
  const selected = /^[0-9a-f-]{36}$/i.test(q.selected ?? '') ? q.selected : undefined;
  const [items,members,customers,opportunities,customer,opportunity]=await Promise.all([listFollowUps(db,{organizationId,id:selected,search:q.q,status,kind,customerId:q.customer,opportunityId:q.opportunity,
    ownerMembershipId:q.owner==='unassigned'?null:q.owner||undefined,from:isDate(q.from)?zonedDayRange(q.from,organization.timezone).startsAt:bounds.from,before:isDate(q.to)?zonedDayRange(shiftDate(q.to,1),organization.timezone).startsAt:bounds.before,
    limit:50,offset:(page-1)*50}),listMembers(db,{organizationId}),listCustomers(db,{organizationId,search:q.customerSearch,limit:20}),listOpportunities(db,{organizationId,customerId:q.customer,search:q.opportunitySearch,limit:20}),q.customer?getCustomer(db,{organizationId,customerId:q.customer}):null,q.opportunity?getOpportunity(db,{organizationId,opportunityId:q.opportunity}):null]);
  const options={organizationId,timezone:organization.timezone,members,mayManage:organization.capabilities.includes('follow_up.manage')};
  const href=`/organizations/${organizationId}/follow-ups`;
  const pageHref=(p:number)=>{const state=new URLSearchParams();for(const [key,value] of Object.entries(q))if(value && key!=='page')state.set(key,value);state.set('page',String(p));return `${href}?${state}`;};
  return <AppPage><CollectionHeader title="Follow-ups" crumbs={workspaceAncestry(organizationId,'follow-ups')} actions={<><ButtonLink href={`${href}/calendar`}>Calendar</ButtonLink>{options.mayManage?<FollowUpSheet {...options}/>:null}</>}/>
    <form method="get" role="search" className="mb-5 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <FormField id="follow-up-q" label="Search follow-ups" className="col-span-2 sm:col-span-1">{p=><TextInput {...p} name="q" type="search" defaultValue={q.q}/>}</FormField>
      <FormField id="follow-up-status" label="Status">{p=><SelectInput {...p} name="status" defaultValue={q.status??'open'}>{['open','completed','cancelled','all'].map(v=><option key={v} value={v}>{v}</option>)}</SelectInput>}</FormField>
      <FormField id="follow-up-kind" label="Type">{p=><SelectInput {...p} name="kind" defaultValue={q.kind??''}><option value="">All types</option>{['call','email','meeting','task'].map(v=><option key={v} value={v}>{v}</option>)}</SelectInput>}</FormField>
      <FormField id="follow-up-owner" label="Owner">{p=><SelectInput {...p} name="owner" defaultValue={q.owner??''}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</SelectInput>}</FormField>
      <FormField id="follow-up-due" label="Due state">{p=><SelectInput {...p} name="due" defaultValue={q.due??''}><option value="">Any time</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option></SelectInput>}</FormField>
      <div className="flex gap-2"><Button type="submit">Filter</Button><ButtonLink href={href}>Reset</ButtonLink></div>
      <details className="col-span-full" open={Boolean(q.customer||q.opportunity||q.from||q.to||q.customerSearch||q.opportunitySearch)}><summary className="cursor-pointer text-sm text-muted">Customer, opportunity and date filters</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <FormField id="follow-up-customer-search" label="Find customer filter">{p=><TextInput {...p} name="customerSearch" type="search" defaultValue={q.customerSearch} placeholder="Name, email or phone"/>}</FormField>
      <FormField id="follow-up-customer" label="Customer">{p=><SelectInput {...p} name="customer" defaultValue={q.customer??''}><option value="">All customers</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}{customer && !customers.some(c=>c.id===customer.id)?<option value={customer.id}>{customer.name}</option>:null}</SelectInput>}</FormField>
      <FormField id="follow-up-opportunity-search" label="Find opportunity filter">{p=><TextInput {...p} name="opportunitySearch" type="search" defaultValue={q.opportunitySearch}/>}</FormField>
      <FormField id="follow-up-opportunity" label="Opportunity">{p=><SelectInput {...p} name="opportunity" defaultValue={q.opportunity??''}><option value="">All opportunities</option>{opportunities.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}{opportunity && !opportunities.some(o=>o.id===opportunity.id)?<option value={opportunity.id}>{opportunity.title}</option>:null}</SelectInput>}</FormField>
      <FormField id="follow-up-from" label="Due from">{p=><TextInput {...p} name="from" type="date" defaultValue={q.from}/>}</FormField><FormField id="follow-up-to" label="Due through">{p=><TextInput {...p} name="to" type="date" defaultValue={q.to}/>}</FormField>
      </div></details>
    </form><p className="mb-2 text-xs text-muted">{items.total} follow-ups · {organization.timezone} · Customer and opportunity choices show up to 20 matches; refine the filter search for more.</p><FollowUpList {...options} items={items}/>
    <div className="mt-4 flex gap-2">{page>1?<ButtonLink href={pageHref(page-1)}>Previous</ButtonLink>:null}{page*50<items.total?<ButtonLink href={pageHref(page+1)}>Next</ButtonLink>:null}</div>
  </AppPage>;
}
