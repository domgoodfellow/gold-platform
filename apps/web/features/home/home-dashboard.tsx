'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, CalendarClock, ChevronDown, CircleAlert, ListTodo, RefreshCw, Settings2, TrendingUp } from 'lucide-react';
import { QuickActions, useHomeCommands } from './command-center';
import { ViewNav } from '@/components/navigation/view-nav';
import { PageHeader } from '@/components/headers/page-header';
import { MetricTile, OperationalPanel, CompactEmptyState, StatePill } from '@/components/operational/primitives';
import { AppPage } from '@/components/layout/app-page';
import { Button } from '@/components/controls/button';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { DataTable, type Column } from '@/components/display/table';
import { Chart } from '@/components/charts/charts';
import { DashboardLayoutGrid, type DashboardWidgetContent } from '@/components/dashboard/dashboard-layout';
import { defaultLayout, type WidgetDefinition } from '@/lib/dashboard-layout';
import { paymentsTrendCharts } from '@/lib/application/finance/dashboard-charts';
import { homePresentation } from '@/lib/application/home/presentation';
import { useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { cx, FOCUS_RING } from '@/components/class-names';
import { DismissButton, useDismissal } from '@/components/feedback/dismissible';
import type { HomeAttentionItem, HomeData, HomeObligation, HomeQuery, HomeSourceData } from '@/lib/application/home/contracts';
export type { HomeData } from '@/lib/application/home/contracts';

function timestamp(value: string, timezone: string, timeOnly = false) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, ...(timeOnly ? {} : { month: 'short', day: 'numeric' }), hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function AttentionRows({ rows, timezone, agent }: { rows: HomeAttentionItem[]; timezone: string; agent: () => void }) {
  const columns: Column<HomeAttentionItem>[] = [{ key: 'subject', header: 'Operational exceptions', emphasis: 'primary', cell: row => <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1">{row.source === 'AI' && row.category === 'approval'
      ? <Button tone="text" size="small" onClick={agent}>Review {row.title} in Agent</Button>
      : <Link aria-label={`Open ${row.title}`} href={row.destination.href} className="break-words font-medium hover:underline">{row.title}</Link>}</div>
      {row.overdue || row.urgency !== 'normal' ? <StatePill tone="warning">{row.overdue ? 'Overdue' : row.urgency === 'critical' ? 'Urgent' : 'High'}</StatePill> : null}</div>
    <p className="break-words text-xs font-normal text-muted">{row.source} - {row.description}</p>
    <p className="break-words text-xs font-normal text-muted">{row.dueAt ? `${row.source === 'Work' ? 'Starts' : 'Due'} ${timestamp(row.dueAt,timezone)}` : 'No deadline'}{row.ownerName ? ` - ${row.ownerName}` : ''}</p>
  </div> }];
  return <DataTable columns={columns} rows={rows} rowKey={row => row.key} empty="No matching attention items."/>;
}
function Obligations({ rows, timezone, empty }: { rows: HomeObligation[]; timezone: string; empty: string }) {
  return rows.length ? <ul className="divide-y divide-border">{rows.map(row => <li key={row.key}><Link href={row.href} data-home-record={row.key} className={cx('flex flex-wrap items-start gap-3 py-3 hover:bg-hover', FOCUS_RING)}>
    <time className="w-28 shrink-0 text-xs tabular-nums text-muted" dateTime={row.at}>{row.allDay ? 'All day' : row.continuing ? `Continues from ${timestamp(row.at, timezone)}` : timestamp(row.at, timezone)}</time>
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 break-words text-xs text-muted">{row.source} - {row.context}</p>{row.endsAt ? <p className="mt-1 text-xs text-muted">Ends {timestamp(row.endsAt, timezone)}</p> : null}<p className="mt-1 text-xs text-muted">{row.owner}</p></div>
  </Link></li>)}</ul> : <CompactEmptyState>{empty}</CompactEmptyState>;
}
function PaymentTrend({ trends, period }: { trends: HomeSourceData['trends']; period: string }) {
  const [currency, setCurrency] = useState('');
  const variants = paymentsTrendCharts(trends.flatMap(trend => trend.points.map(point => ({ day: point.day, currency: trend.currency, amount: String(point.amountMinor) }))), period);
  const selected = variants.find(variant => variant.key === currency) ?? variants[0];
  return selected && selected.data.categories.length > 1 ? <div className="mt-4 border-t border-border pt-4"><Chart title="Payments recorded" data={selected.data} variants={variants} variant={selected.key} onVariantChange={setCurrency} height="compact"/></div> : null;
}
const subscribePreferences = (callback: () => void) => { window.addEventListener('storage', callback); window.addEventListener('home-preferences', callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener('home-preferences', callback); }; };
function usePreferences(key: string) {
  const [error, setError] = useState('');
  const raw = useSyncExternalStore(subscribePreferences, () => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }, () => '');
  const hidden: string[] = (() => { try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && ['performance', 'activity'].includes(v)) : []; } catch { return []; } })();
  const toggle = (panel: string) => { try { localStorage.setItem(key, JSON.stringify(hidden.includes(panel) ? hidden.filter(v => v !== panel) : [...hidden, panel])); window.dispatchEvent(new Event('home-preferences')); setError(''); } catch { setError('Home preferences could not be saved in this browser. Your saved layout is unchanged.'); } };
  return { hidden, toggle, error };
}
/**
 * Choosing which of two panels Home shows is a small, passing choice tied to one control, so it is a
 * popover anchored to Customize rather than a full-height drawer. Each change applies at once and is
 * saved in this browser; Escape or clicking away closes it and returns focus to Customize.
 */
export function CustomizeHome({ hidden, toggle, available = ['performance', 'activity'] }: { hidden: string[]; toggle: (panel: string) => void; available?: string[] }) {
  return <Popover><PopoverTrigger asChild><Button tone="secondary" size="small"><Settings2 aria-hidden className="size-4" />Customize</Button></PopoverTrigger>
    <PopoverContent align="end" aria-labelledby="customize-home-title" className="grid gap-3">
      <div><h2 id="customize-home-title" className="text-sm font-semibold">Customize Home</h2><p className="mt-1 text-xs text-muted">Saved in this browser.</p></div>
      <fieldset className="grid gap-2"><legend className="sr-only">Panels shown on Home</legend>{[['performance', 'Business performance'], ['activity', 'Recent activity']].filter(([key]) => available.includes(key)).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 rounded border border-border px-3 text-sm"><input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</fieldset>
    </PopoverContent></Popover>;
}

const attentionFilters: { label: string; scope: HomeQuery['scope']; attention: HomeQuery['attention'] }[] = [
  { label: 'All', scope: 'organization', attention: 'all' }, { label: 'Mine', scope: 'mine', attention: 'all' },
  { label: 'Urgent', scope: 'organization', attention: 'urgent' }, { label: 'Overdue', scope: 'organization', attention: 'overdue' },
];
const HOME_WIDGETS = [
  { id: 'attention', label: 'Needs attention', spans: [12], defaultSpan: 12, heights: ['standard'], defaultHeight: 'standard', hideable: false, fullOnTablet: true },
  { id: 'priorities', label: 'My priorities', spans: [12], defaultSpan: 12, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'obligations', label: 'Today and upcoming', spans: [6,12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'performance', label: 'Business performance', spans: [6,12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', hideable: true },
  { id: 'activity', label: 'Recent activity', spans: [12], defaultSpan: 12, heights: ['standard'], defaultHeight: 'standard', hideable: true },
] as const satisfies readonly WidgetDefinition[];
const HOME_LAYOUT = { layout: defaultLayout(HOME_WIDGETS), revision: 0, customized: false };
const subscribeTimezone = () => () => {};

export function HomeDashboard({ data, setup }: { data: HomeData; setup?: ReactNode }) {
  const router = useRouter(), [refreshing, refresh] = useTransition(), [expanded, setExpanded] = useState(false);
  const { toggleAgent } = useWorkspaceRail();
  const commands = useHomeCommands(), publish = commands?.publish;
  useEffect(() => { publish?.(data); }, [data, publish]);
  const browserTimezone = useSyncExternalStore(subscribeTimezone, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => data.timezone);
  const preferences = usePreferences(`gildops:home:v1:${data.organizationId}:${data.membershipId}`);
  const { sources, attention, mine, today, upcoming, activity, categories, performance, upcomingLabel, boundedChecks } = homePresentation(data);
  const unavailable = data.results.filter(result => result.state === 'unavailable');
  // Closable until a different set of sources fails to load.
  const outage = useDismissal(`home-unavailable:${data.organizationId}`, unavailable.map(result => result.source).sort().join(','));
  const href = (change: Partial<HomeQuery>) => `/organizations/${data.organizationId}/home?${new URLSearchParams({ ...data.query, ...change })}`;
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(data.refreshedAt)));
  const greeting = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${commands?.displayName ? `, ${commands.displayName.split(' ')[0]}` : ''}`;
  const relevantPerformance = performance.filter(metric => typeof metric.value !== 'number' || metric.value > 0);
  const activityFailed = sources.filter(source => source.health.some(health => health.key.endsWith(':activity-unavailable')));
  const availableOptional = [...(relevantPerformance.length || unavailable.some(result => result.source === 'Finance') ? ['performance'] : []), ...(activity.length || activityFailed.length ? ['activity'] : [])];
  const readable = new Set(['attention', ...(mine.length ? ['priorities'] : []), ...(today.length || upcoming.length || sources.some(source => source.obligationTotals && (source.obligationTotals.today || source.obligationTotals.upcoming)) || unavailable.some(result => ['CRM','Work','Support'].includes(result.source)) ? ['obligations'] : []), ...availableOptional.filter(key => !preferences.hidden.includes(key))]);
  const periodLabel = data.query.when === 'today' ? 'Today' : data.query.when === 'week' ? 'Last 7 days' : 'This month';
  // Tiles that read "now" whatever the period sit apart from the period tabs, in Business overview.
  const ignoresPeriod = (key: string) => key === 'customers' || key.startsWith('Outstanding invoices');
  const periodPerformance = relevantPerformance.filter(metric => !ignoresPeriod(metric.key));
  const currentPerformance = relevantPerformance.filter(metric => ignoresPeriod(metric.key));
  const overview = [...data.kpis, ...currentPerformance];
  const widgets: Record<string, DashboardWidgetContent> = {
    attention: { kind: 'node', node: <OperationalPanel density="compact" title="Needs attention" icon={CircleAlert} action={<ViewNav label="Attention filters" size="small" className="mb-0" items={attentionFilters.map(filter => ({ key: filter.label, label: filter.label, href: href({ scope: filter.scope, attention: filter.attention }), current: data.query.scope === filter.scope && data.query.attention === filter.attention }))}/>}>
      {categories.length ? <nav aria-label="Attention category totals" className="mb-3 flex flex-wrap gap-x-4 gap-y-2">{categories.map(category => <Link key={category.key} href={category.href} className="text-xs text-accent-text hover:underline"><strong className="tabular-nums">{category.total}</strong> {category.label}</Link>)}</nav> : null}
      {attention.length ? <><AttentionRows rows={expanded ? attention : attention.slice(0,6)} timezone={data.timezone} agent={toggleAgent}/>{attention.length > 6 ? <Button tone="text" size="small" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : 'Show all'}<ChevronDown aria-hidden className="size-3"/></Button> : null}</> : <CompactEmptyState kind={unavailable.length ? 'unavailable' : 'empty'}>{unavailable.length ? 'No matching items from the sources that loaded.' : data.query.scope === 'mine' ? 'Nothing assigned to you needs attention.' : data.query.attention === 'all' ? boundedChecks.length ? 'Nothing found needs attention.' : 'Nothing needs attention.' : 'No items match this attention filter.'}</CompactEmptyState>}
      {boundedChecks.map(check => <p key={check.key} className="mt-2 text-xs text-muted">{check.detail}. <Link href={check.href} className="underline">Review the full source</Link></p>)}
    </OperationalPanel> },
    priorities: { kind: 'node', node: <OperationalPanel density="compact" title="My priorities" icon={ListTodo}><ol className="grid gap-3 @min-[40rem]/home:grid-cols-3">{mine.map((row,index) => <li key={row.key} className="rounded border border-border px-3"><Link data-home-record={row.key} href={row.destination.href} className="flex items-start gap-3 py-3 hover:bg-hover"><span className="text-sm tabular-nums text-muted">{index+1}</span><div className="min-w-0"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 text-xs text-muted">{row.source} - {row.dueAt ? timestamp(row.dueAt,data.timezone) : row.description}</p></div></Link></li>)}</ol></OperationalPanel> },
    obligations: { kind: 'node', node: <OperationalPanel density="compact" title="Today and upcoming" icon={CalendarClock} action={<ViewNav label="Obligation period" size="small" className="mb-0" items={[{ key: 'today', label: 'Today', href: href({schedule:'today'}), current:data.query.schedule==='today' },{ key:'upcoming',label:'Upcoming',href:href({schedule:'upcoming'}),current:data.query.schedule==='upcoming' }]}/>}>
      <p className="mb-2 text-xs text-muted">{data.query.schedule === 'today' ? data.date : `Next 7 days · ${upcomingLabel}`}</p>
      {unavailable.some(result => ['CRM','Work','Support'].includes(result.source)) ? <p role="status" className="mb-2 text-xs text-muted">Some of this couldn&apos;t load, so the list may be incomplete.</p> : null}
      <Obligations rows={(data.query.schedule === 'today' ? today : upcoming).slice(0,8)} timezone={data.timezone} empty="Nothing else is due."/>
      <nav aria-label="Full obligation views" className="mt-3 flex flex-wrap gap-3 text-xs">{sources.filter(source => ['Work','CRM','Support'].includes(source.source) && source.obligationTotals && (source.obligationTotals.today || source.obligationTotals.upcoming)).map(source => <Link key={source.source} className="text-accent-text hover:underline" href={source.source === 'Work' ? `/organizations/${data.organizationId}/schedule?on=${data.query.schedule==='today'?data.date:upcomingLabel.slice(0,10)}&view=${data.query.schedule==='today'?'day':'week'}` : source.source === 'CRM' ? `/organizations/${data.organizationId}/crm/tasks?status=open` : `/organizations/${data.organizationId}/support/cases?status=active`}>Open {source.source === 'Work' ? 'Schedule' : source.source === 'CRM' ? 'CRM tasks' : 'Cases'}</Link>)}</nav>
    </OperationalPanel> },
    performance: { kind:'node',node:<OperationalPanel density="compact" title="Business performance" icon={TrendingUp} action={<ViewNav label="Reporting period" size="small" className="mb-0" items={(['today','week','month'] as const).map(when=>({key:when,label:when==='today'?'Today':when==='week'?'Last 7 days':'This month',href:href({when}),current:data.query.when===when}))}/>}>
      {unavailable.some(result=>result.source==='Finance') ? <p role="status" className="mb-3 text-xs text-muted">Finance is unavailable. Its amounts and payment chart are unknown.</p> : null}
      <div className="grid min-w-0 grid-cols-2 gap-3">{periodPerformance.map(metric=><div key={metric.key} title={metric.definition}><MetricTile label={metric.label} value={metric.value} href={metric.href}/></div>)}</div>
      <PaymentTrend trends={sources.flatMap(source=>source.trends)} period={periodLabel}/>
    </OperationalPanel> },
    activity: {kind:'node',node:<OperationalPanel density="compact" title="Recent activity" icon={Activity}>
      {activityFailed.length ? <p role="status" className="text-xs text-muted">Recent activity couldn&apos;t load for {activityFailed.map(source=>source.source).join(', ')}.</p> : null}
      <ul className="divide-y divide-border">{activity.map(item=><li key={item.key}><Link href={item.href} className="flex flex-wrap items-start justify-between gap-2 py-2.5 hover:bg-hover"><div className="min-w-0"><p className="break-words text-sm">{item.title}</p><p className="mt-1 text-xs text-muted">{item.source}</p></div><time className="text-xs text-muted" dateTime={item.at}>{timestamp(item.at,data.timezone)}</time></Link></li>)}</ul>
    </OperationalPanel>},
  };
  return <AppPage className="@container/home space-y-4" aria-busy={refreshing}>
    {setup}
    <PageHeader title={greeting} breadcrumbLabel="Home" meta={<><time dateTime={data.date}>{new Intl.DateTimeFormat('en-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${data.date}T12:00:00Z`))}</time>{browserTimezone!==data.timezone?` | ${data.timezone}`:''}</>} actions={<>{availableOptional.length ? <CustomizeHome hidden={preferences.hidden} toggle={preferences.toggle} available={availableOptional}/> : null}<QuickActions actions={data.quickActions}/></>}/>
    <div className="flex flex-wrap items-center justify-between gap-2">{commands&&data.agentPrompts.length ? <Button tone="secondary" size="small" onClick={commands.openSearch}>Ask or find something...</Button> : <span/>}<Button tone="ghost" size="small" aria-label="Refresh Home" disabled={refreshing} onClick={()=>refresh(()=>router.refresh())}><time dateTime={data.refreshedAt} className="text-xs text-muted">Updated {timestamp(data.refreshedAt,data.timezone,true)}</time><RefreshCw aria-hidden className={cx('size-3',refreshing&&'animate-spin')}/></Button></div>
    {preferences.error ? <p role="alert" className="text-sm text-danger">{preferences.error}</p> : null}
    {unavailable.length && !outage.dismissed ? <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-border bg-warning/10 px-4 py-3 text-xs"><div><p className="font-medium">Some sources are temporarily unavailable</p><p className="mt-1">{unavailable.map(result=>result.source).join(', ')} could not load. Refresh to try again.</p></div><DismissButton label="Close notice" onClick={outage.dismiss} className="-my-2 -mr-3" /></div> : null}
    {overview.length ? <section aria-label="Business overview" className="grid grid-cols-2 gap-3 @min-[60rem]/home:grid-cols-4">{overview.map(metric=><div key={metric.key} title={metric.definition}><MetricTile label={metric.label} value={metric.value} href={metric.href} detail={ignoresPeriod(metric.key) ? 'Now' : undefined}/></div>)}</section> : null}
    <DashboardLayoutGrid registry={HOME_WIDGETS} saved={HOME_LAYOUT} readable={[...readable]} widgets={widgets} label="Organization Home"/>
  </AppPage>;
}
