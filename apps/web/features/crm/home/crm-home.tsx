import { ConfigureMenu } from '@/components/controls/configure-menu';
import type { ConfigureItem } from '@/lib/navigation';
import Link from 'next/link';
import { CalendarDays, CircleCheck } from 'lucide-react';
import { Button,ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { AddContactsTrigger } from '@/features/crm/intake/contact-intake';
import { OpportunitySheet,type OpportunityFormOptions } from '@/features/crm/opportunities/opportunity-sheet';
import { FollowUpSheet,type FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';
import { NeedsAttention,type AttentionCounts } from './needs-attention';
import { RecentRelationships } from './recent-relationships';
import type { Opportunity,OpportunitySummary } from '@/lib/domain/opportunities/opportunities';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import type { RelationshipOverview,RelationshipRow } from '@/lib/domain/contacts/relationship-activity';
import type { CrmSummary,CurrencyTotal,SalesComposition } from '@/lib/application/crm/dashboard';
import { winRate } from '@/lib/application/crm/dashboard';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
export type CrmHomeProps = {
  organizationId:string;timezone:string;month:string;/** Null for a role that may not view contacts: the contact panels are left out, never shown empty. */
  overview:RelationshipOverview|null;
  relationships:{rows:RelationshipRow[];mode:'active'|'added';grouped:boolean};
  /** Null when the sales section is not composed; its queries are then never run. */
  sales:{summary:CrmSummary;stages:OpportunitySummary[]}|null;salesComposition:SalesComposition;
  attention:AttentionCounts;today:CrmTask[];overdue:CrmTask[];noNext:Opportunity[];unassigned:Opportunity[];
  followUpOptions:FollowUpOptions;opportunityOptions:OpportunityFormOptions;
  followUpsEnabled:boolean;conversionEnabled:boolean;/** Whether any way into Contacts (create, import, synchronize) is open to this member. */
  mayAddContacts:boolean;mayCreateOpportunity:boolean;mayConfigure:boolean;
  /** CRM's configuration doors this member may open (`workspaceConfigureItems`): none, one link, or a menu. */
  configureItems?:ConfigureItem[];
};
export function CurrencyValues({values}:{values:CurrencyTotal[]}) {
  return values.length?<>{values.map(v=><span className="block tabular-nums" key={v.currency}>{formatOpportunityValue(v.amount_minor,v.currency)}</span>)}</>:<span className="text-sm font-normal leading-5 text-muted">No valued opportunities</span>;
}
const LIFECYCLES=[['lead','Leads'],['prospect','Prospects'],['customer','Customers'],['unclassified','Unclassified']] as const;
const SHADES={lead:'bg-accent/40',prospect:'bg-accent/70',customer:'bg-accent',unclassified:'bg-border'} as const;
function dashboardHref(base:string,params:{month?:string;group?:boolean}) {
  const query=new URLSearchParams();if(params.month)query.set('month',params.month);if(params.group)query.set('group','company');
  return `${base}/crm${query.size?`?${query}`:''}`;
}
/**
 * CRM Dashboard, relationship first: who the business knows (overview), who it has been dealing with
 * (Recently active relationships, the primary panel), what needs doing (Needs attention, beside it on
 * wide screens and after it in reading order), then Opportunities & Pipeline when sales applies.
 * A new business keeps this structure with real zeros and the Add contacts entry point; there is no
 * separate getting-started page. Document order is reading order at every width.
 */
export function CrmHome({organizationId,timezone,month,overview,relationships,sales,salesComposition,attention,today,overdue,noNext,unassigned,followUpOptions,opportunityOptions,followUpsEnabled,conversionEnabled,mayAddContacts,mayCreateOpportunity,mayConfigure,configureItems=[]}:CrmHomeProps) {
  const base=`/organizations/${organizationId}`; const contacts=`${base}/crm/contacts`;
  const monthParam=month.slice(0,7); const salesEnabled=salesComposition==='full';
  // ADR-050: Calendar is reached in context, from the workspace that owns it, not from global chrome.
  const actions=<><ConfigureMenu items={configureItems} />{followUpsEnabled?<ButtonLink tone="secondary" href={`${base}/crm/calendar`}><CalendarDays aria-hidden/> Calendar</ButtonLink>:null}{mayAddContacts?<AddContactsTrigger/>:null}{mayCreateOpportunity&&salesEnabled?<OpportunitySheet {...opportunityOptions} triggerTone="secondary"/>:null}</>;
  const attentionSources=followUpsEnabled||salesEnabled; const attentionTotal=attention.overdue+attention.today+(salesEnabled?attention.unassigned+(followUpsEnabled?attention.noNext:0):0);
  const allClear=attentionSources&&!attentionTotal;
  const lifecycleTotal=overview?LIFECYCLES.reduce((sum,[key])=>sum+overview.lifecycles[key],0):0;
  return <WorkspaceHome location={{}} activity actions={actions}>
    {overview?<section aria-label="Relationship overview" className="mb-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
      <MetricTile label="Contacts" value={overview.total} detail={<span className="flex flex-wrap gap-x-3 gap-y-1">
        <Link className="underline underline-offset-4" href={`${contacts}?contactType=person`}>{overview.people} {overview.people===1?'person':'people'}</Link>
        <Link className="underline underline-offset-4" href={`${contacts}?contactType=company`}>{overview.companies} {overview.companies===1?'company':'companies'}</Link>
        {overview.unspecified?<Link className="underline underline-offset-4" href={`${contacts}?contactType=unspecified`}>{overview.unspecified} unspecified</Link>:null}</span>}/>
      <MetricTile label="New contacts" value={overview.newLast30Days} detail="Records added in the last 30 days" href={`${contacts}?added=30d`}/>
      <div data-slot="metric-tile" className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3 sm:col-span-2 xl:col-span-1">
        <h2 className="text-xs text-muted">Relationship lifecycle</h2>
        {lifecycleTotal?<div aria-hidden className="mt-2 flex h-2 overflow-hidden rounded-full bg-secondary">{LIFECYCLES.map(([key])=>overview.lifecycles[key]?<span key={key} className={SHADES[key]} style={{width:`${overview.lifecycles[key]/lifecycleTotal*100}%`}}/>:null)}</div>:null}
        <ul aria-label="Contacts by lifecycle" className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">{LIFECYCLES.map(([key,label])=><li key={key}><Link className="flex items-center gap-1.5 hover:underline" href={`${contacts}?lifecycle=${key}`}><span aria-hidden className={`size-2 shrink-0 rounded-full ${SHADES[key]}`}/>{label} <span className="tabular-nums font-semibold">{overview.lifecycles[key]}</span></Link></li>)}</ul>
      </div>
    </section>:null}
    <div className={`mb-6 grid min-w-0 items-start gap-6 ${overview&&attentionSources&&!allClear?'xl:grid-cols-[minmax(0,1fr)_24rem]':''}`}>
      {overview?<RecentRelationships organizationId={organizationId} timezone={timezone} {...relationships} hrefFor={group=>dashboardHref(base,{month:sales?monthParam:undefined,group})} totalContacts={overview.total} mayAddContacts={mayAddContacts}/>:null}
      {attentionSources&&!allClear?<OperationalPanel className="min-w-0" title="Needs attention" action={followUpsEnabled&&followUpOptions.mayManage?<FollowUpSheet {...followUpOptions}/>:null}><NeedsAttention counts={attention} overdue={overdue} today={today} noNext={noNext} unassigned={unassigned} options={followUpOptions} followUpsEnabled={followUpsEnabled} salesEnabled={salesEnabled}/></OperationalPanel>:null}
      {allClear?<p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"><CircleCheck aria-hidden className="size-4 text-muted"/><span><span className="font-medium">Needs attention:</span> nothing overdue{followUpsEnabled?' or due today':''}{salesEnabled?', and every open opportunity has an owner':''}.</span></p>:null}
    </div>
    {salesComposition==='setup'?<OperationalPanel title="Opportunities & Pipeline" density="compact"><PanelState kind="not-configured" action={<ButtonLink tone="secondary" href={`${base}/crm/configuration/opportunity-stages`}>Set up opportunity stages</ButtonLink>}>Track specific sales pursuits by naming opportunity stages. CRM works without them.</PanelState></OperationalPanel>:null}
    {sales&&salesEnabled?<SalesSection base={base} month={month} sales={sales} conversionEnabled={conversionEnabled} mayConfigure={mayConfigure} group={relationships.grouped}/>:null}
  </WorkspaceHome>;
}
function SalesSection({base,month,sales,conversionEnabled,mayConfigure,group}:{base:string;month:string;sales:NonNullable<CrmHomeProps['sales']>;conversionEnabled:boolean;mayConfigure:boolean;group:boolean}) {
  const {summary}=sales; const rate=winRate(summary.won,summary.lost);
  const nextMonth=new Date(`${month}T12:00:00Z`);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const stages=sales.stages.filter(s=>s.stageId); const unstaged=sales.stages.find(s=>s.stageId===null)?.count??0;
  return <OperationalPanel title="Opportunities & Pipeline" href={`${base}/crm/pipeline`} hrefLabel="View pipeline" action={<form method="get" action={`${base}/crm`} className="flex items-center gap-1">{group?<input type="hidden" name="group" value="company"/>:null}<TextInput aria-label="Month for expected closes and win rate" name="month" type="month" defaultValue={month.slice(0,7)} size="small" className="w-36"/><Button type="submit" tone="text" size="small">Apply</Button></form>}>
    <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div><dt className="text-muted">Open opportunities</dt><dd className="mt-1 text-lg font-semibold tabular-nums"><Link className="hover:underline" href={`${base}/crm/opportunities?kind=open`}>{summary.open}</Link></dd>{unstaged?<dd><Link href={`${base}/crm/opportunities?stage=unstaged`} className="text-xs text-muted underline">{unstaged} unstaged</Link></dd>:null}</div>
      <div><dt className="text-muted">Open pipeline value</dt><dd className="mt-1 text-lg font-semibold"><CurrencyValues values={summary.pipeline}/></dd><dd className="text-xs text-muted">Current · each currency separately</dd></div>
      <div><dt className="text-muted">Expected closes</dt><dd className="mt-1 text-lg font-semibold"><Link className="hover:underline" href={`${base}/crm/opportunities?kind=open&closeFrom=${month}&closeBefore=${nextMonth.toISOString().slice(0,10)}`}><CurrencyValues values={summary.forecast}/></Link></dd><dd className="text-xs text-muted">Open, expected to close in the selected month, unweighted</dd></div>
      <div><dt className="text-muted">Win rate</dt><dd className="mt-1">{!conversionEnabled?<span className="text-muted">Unavailable</span>:rate===null?<span className="text-muted">No opportunities closed in the selected month</span>:<span className="text-lg font-semibold">{Math.round(rate*100)}%</span>}</dd>{conversionEnabled&&rate!==null?<dd className="text-xs text-muted">{summary.won} won of {summary.won+summary.lost} closed</dd>:null}</div>
    </dl>
    <div className="mt-4 border-t border-border pt-4">{stages.length?<ul aria-label="Opportunities by stage" className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">{stages.map(stage=><li key={stage.stageId}><Link href={`${base}/crm/opportunities?stage=${stage.stageId}`} className="block h-full rounded-md border border-border bg-surface p-3 hover:bg-hover"><span className="flex justify-between gap-3 text-sm font-medium"><span className="min-w-0 break-words">{stage.name}</span><span className="tabular-nums">{stage.count}</span></span><span className="mt-1 block text-xs capitalize text-muted">{stage.kind}</span>{stage.values.map(v=><span key={v.currency} className="block text-xs tabular-nums">{formatOpportunityValue(v.amountMinor,v.currency)}</span>)}</Link></li>)}</ul>
      :<PanelState kind="not-configured" action={mayConfigure?<ButtonLink tone="secondary" href={`${base}/crm/configuration/opportunity-stages`}>Set up opportunity stages</ButtonLink>:undefined}>No opportunity stages yet, so opportunities are not grouped into a pipeline.</PanelState>}</div>
  </OperationalPanel>;
}
