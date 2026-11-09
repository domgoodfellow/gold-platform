import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import { listTasks,type TaskKind,type TaskStatus } from '@/lib/domain/tasks/tasks';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { followUpsAvailable,dueFilter } from '@/lib/application/crm/follow-ups';
import { listContacts,getContact } from '@/lib/domain/contacts/contacts';
import { listOpportunities,getOpportunity } from '@/lib/domain/opportunities/opportunities';
import { zonedDayRange,shiftDate } from '@/lib/domain/scheduling/window';
import { SelectField } from '@/components/controls/select-field';
export const dynamic='force-dynamic';
export default async function FollowUpsPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {organizationId}=await params; const q=await searchParams;
  const {db,organization}=await requireOrganization(organizationId);
  if(!await followUpsAvailable(db,organizationId))notFound();
  const status=['open','completed','cancelled'].includes(q.status??'')?q.status as TaskStatus:q.status==='all'?undefined:'open';
  const kind=['call','email','meeting','task'].includes(q.kind??'')?q.kind as TaskKind:undefined;
  const page=Math.max(1,parseInt(q.page??'',10)||1);
  const isDate=(raw:string|undefined):raw is string=>Boolean(raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0,10)===raw);
  const bounds=dueFilter(q.due??'',organization.timezone);
  const selected = /^[0-9a-f-]{36}$/i.test(q.selected ?? '') ? q.selected : undefined;
  const [items,members,customers,opportunities,customer,opportunity]=await Promise.all([listTasks(db,{organizationId,id:selected,search:q.q,status,kind,customerId:q.customer,opportunityId:q.opportunity,
    ownerMembershipId:q.owner==='unassigned'?null:q.owner||undefined,from:isDate(q.from)?zonedDayRange(q.from,organization.timezone).startsAt:bounds.from,before:isDate(q.to)?zonedDayRange(shiftDate(q.to,1),organization.timezone).startsAt:bounds.before,
    limit:50,offset:(page-1)*50}),listMembers(db,{organizationId}),listContacts(db,{organizationId,search:q.customerSearch,limit:20}),listOpportunities(db,{organizationId,customerId:q.customer,search:q.opportunitySearch,limit:20}),q.customer?getContact(db,{organizationId,customerId:q.customer}):null,q.opportunity?getOpportunity(db,{organizationId,opportunityId:q.opportunity}):null]);
  const options={organizationId,timezone:organization.timezone,members,mayManage:organization.capabilities.includes('follow_up.manage')};
  const href=`/organizations/${organizationId}/crm/tasks`;
  const pageHref=(p:number)=>{const state=new URLSearchParams();for(const [key,value] of Object.entries(q))if(value && key!=='page')state.set(key,value);state.set('page',String(p));return `${href}?${state}`;};
  return <AppPage><CollectionHeader location={{}} actions={<><ButtonLink href={`${href}/calendar`}>Calendar</ButtonLink>{options.mayManage?<FollowUpSheet {...options}/>:null}</>}/>
    <form method="get" role="search" className="mb-5 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <FormField id="follow-up-q" label="Search tasks" className="col-span-2 sm:col-span-1">{p=><TextInput {...p} name="q" type="search" defaultValue={q.q}/>}</FormField>
      <FormField id="follow-up-status" label="Status">{p=><SelectField {...p} name="status" defaultValue={q.status??'open'} options={[...['open','completed','cancelled','all'].map((v) => ({ value: v, label: v }))]} />}</FormField>
      <FormField id="follow-up-kind" label="Type">{p=><SelectField {...p} name="kind" defaultValue={q.kind??''} options={[{ value: '', label: 'All types' }, ...['call','email','meeting','task'].map((v) => ({ value: v, label: v }))]} />}</FormField>
      <FormField id="follow-up-owner" label="Owner">{p=><SelectField {...p} name="owner" defaultValue={q.owner??''} options={[{ value: '', label: 'All owners' }, { value: 'unassigned', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.displayName }))]} />}</FormField>
      <FormField id="follow-up-due" label="Due state">{p=><SelectField {...p} name="due" defaultValue={q.due??''} options={[{ value: '', label: 'Any time' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'upcoming', label: 'Upcoming' }]} />}</FormField>
      <div className="flex gap-2"><Button type="submit">Filter</Button><ButtonLink href={href}>Reset</ButtonLink></div>
      <details className="col-span-full" open={Boolean(q.customer||q.opportunity||q.from||q.to||q.customerSearch||q.opportunitySearch)}><summary className="cursor-pointer text-sm text-muted">Contact, opportunity and date filters</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <FormField id="follow-up-customer-search" label="Find customer filter">{p=><TextInput {...p} name="customerSearch" type="search" defaultValue={q.customerSearch} placeholder="Name, email or phone"/>}</FormField>
      <FormField id="follow-up-customer" label="Contact">{p=><SelectField {...p} name="customer" defaultValue={q.customer??''} options={[{ value: '', label: 'All customers' }, ...customers.map((c) => ({ value: c.id, label: c.name })), ...(customer && !customers.some(c=>c.id===customer.id) ? [{ value: customer.id, label: customer.name }] : [])]} />}</FormField>
      <FormField id="follow-up-opportunity-search" label="Find opportunity filter">{p=><TextInput {...p} name="opportunitySearch" type="search" defaultValue={q.opportunitySearch}/>}</FormField>
      <FormField id="follow-up-opportunity" label="Opportunity">{p=><SelectField {...p} name="opportunity" defaultValue={q.opportunity??''} options={[{ value: '', label: 'All opportunities' }, ...opportunities.map((o) => ({ value: o.id, label: o.title })), ...(opportunity && !opportunities.some(o=>o.id===opportunity.id) ? [{ value: opportunity.id, label: opportunity.title }] : [])]} />}</FormField>
      <FormField id="follow-up-from" label="Due from">{p=><TextInput {...p} name="from" type="date" defaultValue={q.from}/>}</FormField><FormField id="follow-up-to" label="Due through">{p=><TextInput {...p} name="to" type="date" defaultValue={q.to}/>}</FormField>
      </div></details>
    </form><p className="mb-2 text-xs text-muted">{items.total} tasks · {organization.timezone} · Contact and opportunity choices show up to 20 matches; refine the filter search for more.</p><FollowUpList {...options} items={items}/>
    <div className="mt-4 flex gap-2">{page>1?<ButtonLink href={pageHref(page-1)}>Previous</ButtonLink>:null}{page*50<items.total?<ButtonLink href={pageHref(page+1)}>Next</ButtonLink>:null}</div>
  </AppPage>;
}
