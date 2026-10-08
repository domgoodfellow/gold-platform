import Link from 'next/link';
import type { ReactNode } from 'react';
import { Users, CircleDollarSign, CalendarClock, TrendingUp } from 'lucide-react';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { CreateCustomerTrigger } from '@/features/crm/customers/create-customer-sheet';
import { OpportunitySheet,type OpportunityFormOptions } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityTable } from '@/features/crm/opportunities/opportunity-table';
import { FollowUpList } from '@/features/crm/follow-ups/follow-up-list';
import { FollowUpSheet,type FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';
import { NeedsAttention } from './needs-attention';
import type { Customer } from '@/lib/domain/customers/customers';
import type { Opportunity,OpportunitySummary } from '@/lib/domain/opportunities/opportunities';
import type { FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import type { CrmSummary,CurrencyTotal } from '@/lib/application/crm/dashboard';
import { winRate } from '@/lib/application/crm/dashboard';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
export type CrmHomeProps = {
  organizationId:string;timezone:string;month:string;summary:CrmSummary;customers:Customer[];
  customerContext:Record<string,{stage:string;touch:string|null;next:FollowUp|null}>;
  opportunitySummary:OpportunitySummary[];opportunities:Opportunity[];today:FollowUp[];overdue:FollowUp[];
  noNext:Opportunity[];unassigned:Opportunity[];followUpOptions:FollowUpOptions;opportunityOptions:OpportunityFormOptions;
  followUpsEnabled:boolean;conversionEnabled:boolean;mayCreate:boolean;mayCreateOpportunity:boolean;mayConfigure:boolean;activity:ReactNode;
};
export function CurrencyValues({values}:{values:CurrencyTotal[]}) {
  return values.length?<>{values.map(v=><span className="block tabular-nums" key={v.currency}>{formatOpportunityValue(v.amount_minor,v.currency)}</span>)}</>:<>No valued opportunities</>;
}
export function CrmHome({organizationId,timezone,month,summary,customers,customerContext,opportunitySummary,opportunities,today,overdue,noNext,unassigned,followUpOptions,opportunityOptions,followUpsEnabled,conversionEnabled,mayCreate,mayCreateOpportunity,mayConfigure,activity}:CrmHomeProps) {
  const base=`/organizations/${organizationId}`; const rate=winRate(summary.won,summary.lost);
  const nextMonth=new Date(`${month}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const kpis=[{label:'Customers',value:summary.customers,context:'Customer relationships',href:`${base}/customers`,icon:Users},
    {label:'Open opportunities',value:summary.open,context:'In stages classified Open',href:`${base}/opportunities?kind=open`,icon:CircleDollarSign},
    {label:'Follow-ups due today',value:followUpsEnabled?summary.today:'Unavailable',context:timezone,href:followUpsEnabled?`${base}/follow-ups?status=open&due=today`:undefined,icon:CalendarClock},
    {label:'Forecast this month',value:<CurrencyValues values={summary.forecast}/>,context:'Open · unweighted expected close',href:`${base}/opportunities?kind=open&closeFrom=${month}&closeBefore=${nextMonth.toISOString().slice(0,10)}`,icon:TrendingUp}];
  return <WorkspaceHome title="CRM" configure={mayConfigure} actions={<>
    <form action={`${base}/sales/search`} method="get" role="search" className="flex items-center gap-1"><TextInput aria-label="Search CRM" type="search" name="q" placeholder="Search CRM" className="w-40"/><Button type="submit" tone="text" size="small">Search</Button></form>
    <form method="get" className="flex items-center gap-1"><TextInput aria-label="Reporting month" name="month" type="month" defaultValue={month.slice(0,7)} className="w-40"/><Button type="submit" tone="text" size="small">Apply</Button></form>
    {mayCreate?<CreateCustomerTrigger/>:null}{mayCreateOpportunity?<OpportunitySheet {...opportunityOptions}/>:null}
  </>}>
    <p className="-mt-3 mb-5 text-sm text-muted">Relationships, opportunities and the next action.</p>
    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(kpi=>{const Icon=kpi.icon; const content=<><div className="flex items-center justify-between gap-2 text-xs text-muted sm:text-sm"><span>{kpi.label}</span><Icon aria-hidden size={17} className="shrink-0"/></div><div className={`my-3 font-semibold tracking-tight ${kpi.label==='Forecast this month'?'text-base sm:text-xl':'text-2xl sm:text-3xl'}`}>{kpi.value}</div><p className="text-xs text-muted">{kpi.context}</p></>;return kpi.href?<Link key={kpi.label} href={kpi.href} className="rounded-lg border border-border p-3 transition-colors hover:bg-surface sm:p-4">{content}</Link>:<div key={kpi.label} className="rounded-lg border border-border p-3 sm:p-4">{content}</div>;})}</div>
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-1 min-w-0 space-y-6 xl:order-none">
        <section className="min-w-0 rounded-lg border border-border p-4" aria-labelledby="needs-attention-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="needs-attention-heading" className="text-base font-semibold">Needs attention</h2>{followUpsEnabled && followUpOptions.mayManage?<FollowUpSheet {...followUpOptions}/>:null}</div><NeedsAttention summary={summary} overdue={overdue} today={today} noNext={noNext} unassigned={unassigned} options={followUpOptions} followUpsEnabled={followUpsEnabled}/></section>
        <section className="min-w-0 space-y-4" aria-labelledby="pipeline-heading"><div className="flex items-center justify-between gap-2"><h2 id="pipeline-heading" className="text-base font-semibold">Pipeline</h2><ButtonLink tone="text" href={`${base}/opportunities/pipeline`}>View pipeline</ButtonLink></div>
          {opportunitySummary.filter(s=>s.stageId).length?<div className="flex gap-2 overflow-x-auto pb-2">{opportunitySummary.filter(s=>s.stageId).map(stage=><Link key={stage.stageId} href={`${base}/opportunities?stage=${stage.stageId}`} className="min-w-36 flex-1 rounded-md border-t-2 border-foreground bg-surface p-3"><div className="flex justify-between gap-3 text-sm font-medium"><span>{stage.name}</span><span>{stage.count}</span></div><p className="my-1 text-xs capitalize text-muted">{stage.kind}</p>{stage.values.map(v=><p key={v.currency} className="text-xs tabular-nums">{formatOpportunityValue(v.amountMinor,v.currency)}</p>)}</Link>)}</div>:<p className="text-sm text-muted">No opportunity stages configured.{mayConfigure?<> <Link className="underline" href={`${base}/settings/opportunity-stages`}>Configure opportunity stages</Link></>:null}</p>}
          {opportunitySummary.find(s=>s.stageId===null)?.count?<Link href={`${base}/opportunities?stage=unstaged`} className="text-xs text-muted underline">{opportunitySummary.find(s=>s.stageId===null)?.count} unstaged opportunities</Link>:null}
          <OpportunityTable organizationId={organizationId} opportunities={opportunities} timezone={timezone} followUpOptions={followUpsEnabled?followUpOptions:undefined}/>
        </section>
        <section className="min-w-0" aria-labelledby="recent-customers-heading"><div className="mb-3 flex items-center justify-between"><h2 id="recent-customers-heading" className="text-base font-semibold">Recent customers</h2><ButtonLink tone="text" href={`${base}/customers`}>View all customers</ButtonLink></div>
          {customers.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs text-muted"><tr>{['Customer','Relationship stage','Last CRM touchpoint','Next follow-up'].map(label=><th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{customers.map(customer=>{const context=customerContext[customer.id];return <tr key={customer.id}><td className="px-3 py-3 font-medium"><Link href={`${base}/customers/${customer.id}`}>{customer.name}</Link></td><td className="px-3 py-3 text-muted">{context?.stage ?? 'Unstaged'}</td><td className="px-3 py-3 text-xs text-muted">{context?.touch?new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium'}).format(new Date(context.touch)):'No CRM activity'}</td><td className="min-w-36 px-3 py-3">{context?.next?<FollowUpSheet {...followUpOptions} item={context.next}>{context.next.title}</FollowUpSheet>:<span className="text-muted">Not scheduled</span>}</td></tr>;})}</tbody></table></div>:<p className="py-5 text-sm text-muted">No customers yet. Add your first customer to start working.</p>}
        </section>
        <section aria-labelledby="crm-insights-heading" className="border-t border-border pt-5"><h2 id="crm-insights-heading" className="mb-3 text-base font-semibold">CRM Insights</h2><div className="grid gap-5 sm:grid-cols-2"><div><p className="text-sm text-muted">Opportunity win rate · {month.slice(0,7)}</p><p className="mt-2 text-2xl font-semibold">{!conversionEnabled?'Unavailable':rate===null?'No closed opportunities':`${Math.round(rate*100)}%`}</p>{conversionEnabled?<><p className="mt-1 text-xs text-muted">{summary.won} won / {summary.won+summary.lost} closed · last closed transition per opportunity this month</p>{rate!==null?<div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-foreground" style={{width:`${rate*100}%`}}/></div>:null}</>:null}</div><div><p className="text-sm text-muted">Current open pipeline value</p><div className="mt-2 text-xl font-semibold"><CurrencyValues values={summary.pipeline}/></div><p className="mt-1 text-xs text-muted">Separate totals for each currency</p></div></div></section>
      </div>
      <aside className="contents min-w-0 xl:block xl:space-y-6 xl:border-l xl:border-border xl:pl-5">
        <section aria-labelledby="crm-today-heading"><div className="mb-2 flex items-center justify-between"><h2 id="crm-today-heading" className="text-base font-semibold">Today <span className="ml-1 text-sm text-muted">{followUpsEnabled?summary.today:''}</span></h2>{followUpsEnabled?<ButtonLink tone="text" href={`${base}/follow-ups/calendar`}>View calendar</ButtonLink>:null}</div>{followUpsEnabled?<><FollowUpList {...followUpOptions} items={today} compact/>{summary.today>today.length?<ButtonLink tone="text" href={`${base}/follow-ups?status=open&due=today`}>View all today</ButtonLink>:null}</>:<p className="py-5 text-sm text-muted">Follow-ups are not active.</p>}</section>
        <section aria-labelledby="crm-activity-heading" className="order-2 border-t border-border pt-5"><h2 id="crm-activity-heading" className="mb-3 text-base font-semibold">Recent activity</h2>{activity}</section>
      </aside>
    </div>
  </WorkspaceHome>;
}
