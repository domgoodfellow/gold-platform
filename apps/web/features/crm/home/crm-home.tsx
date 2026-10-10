import Link from 'next/link';
import type { ReactNode } from 'react';
import { Users, CircleDollarSign, CalendarClock, TrendingUp } from 'lucide-react';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
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
  return values.length?<>{values.map(v=><span className="block tabular-nums" key={v.currency}>{formatOpportunityValue(v.amount_minor,v.currency)}</span>)}</>:<span className="text-sm font-normal leading-5 text-muted">No valued opportunities</span>;
}
export function CrmHome({organizationId,timezone,month,summary,customers,customerContext,opportunitySummary,opportunities,today,overdue,noNext,unassigned,followUpOptions,opportunityOptions,followUpsEnabled,conversionEnabled,mayCreate,mayCreateOpportunity,mayConfigure,activity}:CrmHomeProps) {
  const base=`/organizations/${organizationId}`; const rate=winRate(summary.won,summary.lost);
  const nextMonth=new Date(`${month}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const kpis=[{label:'Customers',value:summary.customers,context:'Customer relationships',href:`${base}/customers`,icon:Users},
    {label:'Open opportunities',value:summary.open,context:'In stages classified Open',href:`${base}/opportunities?kind=open`,icon:CircleDollarSign},
    {label:'Follow-ups due today',value:followUpsEnabled?summary.today:'Unavailable',context:timezone,href:followUpsEnabled?`${base}/follow-ups?status=open&due=today`:undefined,icon:CalendarClock},
    {label:'Forecast this month',value:<CurrencyValues values={summary.forecast}/>,context:'Open · unweighted expected close',href:`${base}/opportunities?kind=open&closeFrom=${month}&closeBefore=${nextMonth.toISOString().slice(0,10)}`,icon:TrendingUp}];
  return <WorkspaceHome title="CRM" configure={mayConfigure} actions={<>
    <form method="get" className="flex items-center gap-1"><TextInput aria-label="Reporting month" name="month" type="month" defaultValue={month.slice(0,7)} className="w-40"/><Button type="submit" tone="text" size="small">Apply</Button></form>
    {mayCreate?<CreateCustomerTrigger/>:null}{mayCreateOpportunity?<OpportunitySheet {...opportunityOptions}/>:null}
  </>}>
    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(kpi=><MetricTile key={kpi.label} label={kpi.label} value={kpi.value} detail={kpi.context} icon={kpi.icon} href={kpi.href}/>)}</div>
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-1 min-w-0 space-y-6 xl:order-none">
        <OperationalPanel title="Needs attention" action={followUpsEnabled && followUpOptions.mayManage?<FollowUpSheet {...followUpOptions}/>:null}><NeedsAttention summary={summary} overdue={overdue} today={today} noNext={noNext} unassigned={unassigned} options={followUpOptions} followUpsEnabled={followUpsEnabled}/></OperationalPanel>
        <OperationalPanel title="Pipeline" href={`${base}/opportunities/pipeline`} hrefLabel="View pipeline"><div className="space-y-4">
          {opportunitySummary.filter(s=>s.stageId).length?<div className="flex gap-2 overflow-x-auto pb-2">{opportunitySummary.filter(s=>s.stageId).map(stage=><Link key={stage.stageId} href={`${base}/opportunities?stage=${stage.stageId}`} className="min-w-36 flex-1 rounded-md border-t-2 border-foreground bg-surface p-3"><div className="flex justify-between gap-3 text-sm font-medium"><span>{stage.name}</span><span>{stage.count}</span></div><p className="my-1 text-xs capitalize text-muted">{stage.kind}</p>{stage.values.map(v=><p key={v.currency} className="text-xs tabular-nums">{formatOpportunityValue(v.amountMinor,v.currency)}</p>)}</Link>)}</div>:<PanelState kind="not-configured" action={mayConfigure?<ButtonLink tone="secondary" href={`${base}/settings/opportunity-stages`}>Configure opportunity stages</ButtonLink>:undefined}>No opportunity stages are configured, so there is no pipeline to show yet.</PanelState>}
          {opportunitySummary.find(s=>s.stageId===null)?.count?<Link href={`${base}/opportunities?stage=unstaged`} className="text-xs text-muted underline">{opportunitySummary.find(s=>s.stageId===null)?.count} unstaged opportunities</Link>:null}
          <OpportunityTable organizationId={organizationId} opportunities={opportunities} timezone={timezone} followUpOptions={followUpsEnabled?followUpOptions:undefined}/>
        </div></OperationalPanel>
        <OperationalPanel title="Recent customers" href={`${base}/customers`} hrefLabel="View all customers" flush>
          {customers.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs text-muted"><tr>{['Customer','Relationship stage','Last CRM touchpoint','Next follow-up'].map(label=><th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{customers.map(customer=>{const context=customerContext[customer.id];return <tr key={customer.id}><td className="px-3 py-3 font-medium"><Link href={`${base}/customers/${customer.id}`}>{customer.name}</Link></td><td className="px-3 py-3 text-muted">{context?.stage ?? 'Unstaged'}</td><td className="px-3 py-3 text-xs text-muted">{context?.touch?new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium'}).format(new Date(context.touch)):'No CRM activity'}</td><td className="min-w-36 px-3 py-3">{context?.next?<FollowUpSheet {...followUpOptions} item={context.next}>{context.next.title}</FollowUpSheet>:<span className="text-muted">Not scheduled</span>}</td></tr>;})}</tbody></table></div>:<PanelState>No customers yet. Add your first customer to start working.</PanelState>}
        </OperationalPanel>
        <OperationalPanel title="CRM Insights"><div className="grid gap-5 sm:grid-cols-2"><div><p className="text-sm text-muted">Opportunity win rate · {month.slice(0,7)}</p><p className="mt-2 text-2xl font-semibold">{!conversionEnabled?'Unavailable':rate===null?'No closed opportunities':`${Math.round(rate*100)}%`}</p>{conversionEnabled?<><p className="mt-1 text-xs text-muted">{summary.won} won / {summary.won+summary.lost} closed · last closed transition per opportunity this month</p>{rate!==null?<div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-foreground" style={{width:`${rate*100}%`}}/></div>:null}</>:null}</div><div><p className="text-sm text-muted">Current open pipeline value</p><div className="mt-2 text-xl font-semibold"><CurrencyValues values={summary.pipeline}/></div><p className="mt-1 text-xs text-muted">Separate totals for each currency</p></div></div></OperationalPanel>
      </div>
      <aside className="contents min-w-0 xl:block xl:space-y-6">
        <OperationalPanel title="Today" count={followUpsEnabled?summary.today:undefined} href={followUpsEnabled?`${base}/follow-ups/calendar`:undefined} hrefLabel="View calendar">{followUpsEnabled?<><FollowUpList {...followUpOptions} items={today} compact/>{summary.today>today.length?<ButtonLink tone="text" href={`${base}/follow-ups?status=open&due=today`}>View all today</ButtonLink>:null}</>:<PanelState kind="not-configured">Follow-ups are not active for this organization.</PanelState>}</OperationalPanel>
        <OperationalPanel title="Recent activity" className="order-2">{activity}</OperationalPanel>
      </aside>
    </div>
  </WorkspaceHome>;
}
