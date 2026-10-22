import { ConfigureMenu } from '@/components/controls/configure-menu';
import type { ConfigureItem } from '@/lib/navigation';
import Link from 'next/link';
import { Users, CircleDollarSign, CalendarClock, TrendingUp } from 'lucide-react';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { CreateCustomerTrigger } from '@/features/crm/customers/create-customer-sheet';
import { OpportunitySheet,type OpportunityFormOptions } from '@/features/crm/opportunities/opportunity-sheet';
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
  opportunitySummary:OpportunitySummary[];today:FollowUp[];overdue:FollowUp[];
  noNext:Opportunity[];unassigned:Opportunity[];followUpOptions:FollowUpOptions;opportunityOptions:OpportunityFormOptions;
  followUpsEnabled:boolean;conversionEnabled:boolean;mayCreate:boolean;mayCreateOpportunity:boolean;mayConfigure:boolean;
  /** CRM's configuration doors this member may open (`workspaceConfigureItems`): none, one link, or a menu. */
  configureItems?:ConfigureItem[];
};
export function CurrencyValues({values}:{values:CurrencyTotal[]}) {
  return values.length?<>{values.map(v=><span className="block tabular-nums" key={v.currency}>{formatOpportunityValue(v.amount_minor,v.currency)}</span>)}</>:<span className="text-sm font-normal leading-5 text-muted">No valued opportunities</span>;
}
/**
 * CRM Home: what needs doing now, then how the pipeline stands. Today owns the day's agenda and
 * Needs attention owns exceptions (overdue, no next step, unassigned), so nothing is listed twice.
 * The month picker sits on the one panel it filters. Recent activity lives in the Activity panel
 * rather than setting the height of the page. A business with no customers, opportunities or stages
 * sees one getting-started panel instead of a row of empty ones. Panels are in task order in the
 * document (Needs attention, Today, Pipeline, This month, Recent customers), so narrow screens and
 * keyboard and screen-reader order agree; the wide layout only places them in two columns.
 */
export function CrmHome({organizationId,timezone,month,summary,customers,customerContext,opportunitySummary,today,overdue,noNext,unassigned,followUpOptions,opportunityOptions,followUpsEnabled,conversionEnabled,mayCreate,mayCreateOpportunity,mayConfigure,configureItems=[]}:CrmHomeProps) {
  const base=`/organizations/${organizationId}`; const rate=winRate(summary.won,summary.lost);
  const nextMonth=new Date(`${month}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const stages=opportunitySummary.filter(s=>s.stageId); const unstaged=opportunitySummary.find(s=>s.stageId===null)?.count??0;
  const fresh=summary.customers===0&&summary.open===0&&stages.length===0;
  const actions=<><ConfigureMenu items={configureItems} />{mayCreate?<CreateCustomerTrigger/>:null}{mayCreateOpportunity?<OpportunitySheet {...opportunityOptions}/>:null}</>;
  if(fresh) return <WorkspaceHome location={{}} actions={actions}>
    <OperationalPanel title="Get started with CRM"><ol className="grid gap-4 text-sm sm:grid-cols-3">
      <li><p className="font-medium">1. Add your customers</p><p className="mt-1 text-muted">Everything in CRM hangs off a customer: stages, opportunities and follow-ups.</p>{mayCreate?<div className="mt-3"><CreateCustomerTrigger/></div>:null}</li>
      <li><p className="font-medium">2. Name your opportunity stages</p><p className="mt-1 text-muted">Stages make the pipeline. Mark one Won and one Lost to measure win rate.</p>{mayConfigure?<ButtonLink className="mt-3" tone="secondary" href={`${base}/sales/configuration/opportunity-stages`}>Set up stages</ButtonLink>:null}</li>
      <li><p className="font-medium">3. Plan the next step</p><p className="mt-1 text-muted">{followUpsEnabled?'Follow-ups due today appear here; overdue ones and opportunities without a next step are flagged.':'Follow-ups are not active for this business.'}</p></li>
    </ol></OperationalPanel>
  </WorkspaceHome>;
  const kpis=[{label:'Customers',value:summary.customers,context:'Customer relationships',href:`${base}/customers`,icon:Users},
    {label:'Open opportunities',value:summary.open,context:'In stages classified Open',href:`${base}/opportunities?kind=open`,icon:CircleDollarSign},
    {label:'Overdue follow-ups',value:followUpsEnabled?summary.overdue:'Unavailable',context:followUpsEnabled?'Open and past due':'Follow-ups not active',href:followUpsEnabled?`${base}/follow-ups?status=open&due=overdue`:undefined,icon:CalendarClock},
    {label:'Open pipeline value',value:<CurrencyValues values={summary.pipeline}/>,context:'Current · each currency separately',href:`${base}/opportunities/pipeline`,icon:TrendingUp}];
  return <WorkspaceHome location={{}} activity actions={actions}>
    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(kpi=><MetricTile key={kpi.label} label={kpi.label} value={kpi.value} detail={kpi.context} icon={kpi.icon} href={kpi.href}/>)}</div>
    {/* Reading order is task order at every width; the wide layout places Today and This month in the right column. */}
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <OperationalPanel className="min-w-0 xl:col-start-1" title="Needs attention" action={followUpsEnabled && followUpOptions.mayManage?<FollowUpSheet {...followUpOptions}/>:null}><NeedsAttention summary={summary} overdue={overdue} noNext={noNext} unassigned={unassigned} options={followUpOptions} followUpsEnabled={followUpsEnabled}/></OperationalPanel>
        <OperationalPanel className="min-w-0 xl:col-start-2" title="Today" count={followUpsEnabled?summary.today:undefined} href={`${base}/sales/calendar`} hrefLabel="View calendar">{followUpsEnabled?<><FollowUpList {...followUpOptions} items={today} compact/>{summary.today>today.length?<ButtonLink tone="text" href={`${base}/follow-ups?status=open&due=today`}>View all today</ButtonLink>:null}</>:<PanelState kind="not-configured">Follow-ups are not active for this organization.</PanelState>}</OperationalPanel>
        <OperationalPanel className="min-w-0 xl:col-start-1" title="Pipeline" href={`${base}/opportunities/pipeline`} hrefLabel="View pipeline">
          {stages.length?<ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">{stages.map(stage=><li key={stage.stageId}><Link href={`${base}/opportunities?stage=${stage.stageId}`} className="block h-full rounded-md border border-border bg-surface p-3 hover:bg-hover"><span className="flex justify-between gap-3 text-sm font-medium"><span className="min-w-0 break-words">{stage.name}</span><span className="tabular-nums">{stage.count}</span></span><span className="mt-1 block text-xs capitalize text-muted">{stage.kind}</span>{stage.values.map(v=><span key={v.currency} className="block text-xs tabular-nums">{formatOpportunityValue(v.amountMinor,v.currency)}</span>)}</Link></li>)}</ul>:<PanelState kind="not-configured" action={mayConfigure?<ButtonLink tone="secondary" href={`${base}/sales/configuration/opportunity-stages`}>Set up opportunity stages</ButtonLink>:undefined}>No opportunity stages yet, so there is no pipeline to show.</PanelState>}
          {unstaged?<Link href={`${base}/opportunities?stage=unstaged`} className="mt-3 inline-block text-xs text-muted underline">{unstaged} unstaged opportunities</Link>:null}
        </OperationalPanel>
        <OperationalPanel className="min-w-0 xl:col-start-2" title="This month" action={<form method="get" className="flex items-center gap-1"><TextInput aria-label="Month for forecast and win rate" name="month" type="month" defaultValue={month.slice(0,7)} size="small" className="w-36"/><Button type="submit" tone="text" size="small">Apply</Button></form>}>
          <dl className="grid gap-4 text-sm">
            <div><dt className="text-muted">Forecast</dt><dd className="mt-1 text-lg font-semibold"><Link className="hover:underline" href={`${base}/opportunities?kind=open&closeFrom=${month}&closeBefore=${nextMonth.toISOString().slice(0,10)}`}><CurrencyValues values={summary.forecast}/></Link></dd><dd className="text-xs text-muted">Open opportunities expected to close this month, unweighted</dd></div>
            <div><dt className="text-muted">Win rate</dt><dd className="mt-1">{!conversionEnabled?<span className="text-muted">Unavailable</span>:rate===null?<span className="text-muted">No opportunities closed this month</span>:<span className="text-lg font-semibold">{Math.round(rate*100)}%</span>}</dd>{conversionEnabled&&rate!==null?<dd className="text-xs text-muted">{summary.won} won of {summary.won+summary.lost} closed</dd>:null}</div>
          </dl>
        </OperationalPanel>
        <OperationalPanel className="min-w-0 xl:col-start-1" title="Recent customers" href={`${base}/customers`} hrefLabel="View all customers" body="edge-to-edge">
          {customers.length?<ul className="divide-y divide-border">{customers.map(customer=>{const context=customerContext[customer.id];return <li key={customer.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-3"><Link className="min-w-0 break-words font-medium hover:underline" href={`${base}/customers/${customer.id}`}>{customer.name}</Link><span className="text-xs text-muted">{context?.stage ?? 'Unstaged'} · {context?.touch?`Last touch ${new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'medium'}).format(new Date(context.touch))}`:'No CRM activity'}</span><span className="min-w-0 text-xs">{context?.next?<FollowUpSheet {...followUpOptions} item={context.next}>{context.next.title}</FollowUpSheet>:<span className="text-muted">No follow-up scheduled</span>}</span></li>;})}</ul>:<PanelState>No customers yet.</PanelState>}
        </OperationalPanel>
    </div>
  </WorkspaceHome>;
}
