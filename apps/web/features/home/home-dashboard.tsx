'use client';

import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@gold/ui/components/tabs';
import { QuickActions, useHomeCommands } from './command-center';
import { ViewNav } from '@/components/navigation/view-nav';
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, CalendarClock, ChevronDown, CircleAlert, ListTodo, RefreshCw, Settings2, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/headers/page-header';
import { OperationalPanel, PanelState, StatePill } from '@/components/operational/primitives';
import { AppPage } from '@/components/layout/app-page';
import { Button } from '@/components/controls/button';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { useWorkspaceRail } from '@/components/panels/workspace-right-rail';
import { cx, FOCUS_RING } from '@/components/class-names';
import { prioritize, type HomeAttentionItem, type HomeData, type HomeObligation, type HomeQuery, type HomeSourceData } from '@/lib/application/home/contracts';
import { zonedDayRange } from '@/lib/domain/scheduling/window';
import { formatMoney } from '@/lib/domain/work-items/consumption';
export type { HomeData } from '@/lib/application/home/contracts';

function timestamp(value: string, timezone: string, timeOnly = false) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, ...(timeOnly ? {} : { month: 'short', day: 'numeric' }), hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function AttentionRows({ rows, timezone, agent }: { rows: HomeAttentionItem[]; timezone: string; agent: () => void }) {
  const priority = (row: HomeAttentionItem) => row.overdue || row.urgency !== 'normal' ? <StatePill tone="warning">{row.overdue ? 'Overdue' : row.urgency === 'critical' ? 'Urgent' : 'High'}</StatePill> : null;
  const date = (row: HomeAttentionItem) => row.dueAt || row.occurredAt ? <time dateTime={row.dueAt ?? row.occurredAt}>{timestamp((row.dueAt ?? row.occurredAt)!, timezone)}</time> : 'No deadline';
  const action = (row: HomeAttentionItem) => row.source === 'AI' && row.category === 'approval'
    ? <button type="button" aria-label={`Review ${row.title} in Agent`} onClick={agent} className={cx('absolute inset-0 rounded-md', FOCUS_RING)} />
    : <Link aria-label={`Open ${row.title}`} href={row.destination.href} className={cx('absolute inset-0 rounded-md', FOCUS_RING)} />;
  return <>
    <div className="hidden @min-[48rem]/home:block"><table className="w-full table-fixed text-left text-xs"><caption className="sr-only">Needs attention</caption><thead className="border-b border-border bg-secondary/60 text-[11px] text-muted"><tr>{['Type', 'Subject', 'Priority', 'Due / activity', 'Owner'].map((heading, index) => <th key={heading} scope="col" className={cx('px-3 py-2 font-medium', index === 1 ? 'w-[32%]' : '')}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map(row => <tr key={row.key} className="relative hover:bg-hover focus-within:bg-hover"><td className="break-words px-3 py-3"><span className="inline-block rounded border border-border px-2 py-1 text-[10px] capitalize">{row.record.kind.replaceAll('-', ' ')}</span></td><td className="px-3 py-3"><span className="break-words font-medium">{row.title}</span><p className="mt-1 break-words text-[11px] text-muted">{row.description}</p>{action(row)}</td><td className="px-3 py-3">{priority(row)}</td><td className="px-3 py-3 text-[11px] text-muted">{date(row)}</td><td className="break-words px-3 py-3 text-[11px] text-muted">{row.ownerName ?? (row.ownerMembershipId ? 'Assigned member' : 'Unassigned')}</td></tr>)}</tbody></table></div>
    <ul className="divide-y divide-border @min-[48rem]/home:hidden">{rows.map(row => <li key={row.key} className="relative space-y-2 px-4 py-3 hover:bg-hover focus-within:bg-hover"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] capitalize text-muted">{row.source} | {row.record.kind.replaceAll('-', ' ')}</span>{priority(row)}</div><p className="break-words text-sm font-medium">{row.title}</p><p className="break-words text-xs text-muted">{row.description}</p><p className="text-[11px] text-muted">{date(row)} | {row.ownerName ?? 'Unassigned'}</p>{action(row)}</li>)}</ul>
  </>;
}
function Obligations({ rows, timezone, today = false, createHref, incomplete = false }: { rows: HomeObligation[]; timezone: string; today?: boolean; createHref?: string; incomplete?: boolean }) {
  return rows.length ? <ul className="divide-y divide-border">{rows.map(row => <li key={row.key}><Link href={row.href} className={cx('flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 hover:bg-hover', FOCUS_RING)}><time className="w-24 shrink-0 text-xs tabular-nums text-muted" dateTime={row.at}>{timestamp(row.at, timezone, today)}</time><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 break-words text-xs text-muted">{row.context}</p><p className="mt-1 text-[11px] text-muted">{row.owner}</p></div><ArrowRight aria-hidden className="size-3 text-muted" /></Link></li>)}</ul> : <PanelState kind={incomplete ? 'unavailable' : 'empty'}>{incomplete ? 'Schedule could not fully load. Try refreshing.' : today ? 'Nothing scheduled for today.' : 'Nothing scheduled in the next 7 days.'}{createHref ? <Link href={createHref} className={cx('mt-3 block rounded text-sm font-medium underline', FOCUS_RING)}>Schedule work</Link> : null}</PanelState>;
}
function PaymentTrend({ trends }: { trends: HomeSourceData['trends'] }) {
  const [currency, setCurrency] = useState('');
  const selected = trends.find(t => t.currency === currency) ?? trends[0];
  if (!selected || selected.points.length < 2) return null;
  const max = Math.max(1, ...selected.points.map(p => Math.abs(p.amountMinor)));
  return <div className="border-t border-border p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium">Payments recorded by local day</p><label className="flex items-center gap-2 text-xs text-muted">Currency<select className="rounded border border-border bg-surface px-2 py-1" value={selected.currency} onChange={e => setCurrency(e.target.value)}>{trends.map(t => <option key={t.currency}>{t.currency}</option>)}</select></label></div><div className="flex h-24 items-end gap-1" aria-hidden>{selected.points.map(p => <div key={p.day} className={cx('min-w-0 flex-1 rounded-t', p.amountMinor < 0 ? 'bg-warning/60' : 'bg-foreground/65')} style={{ height: `${Math.max(p.amountMinor ? 3 : 0, Math.abs(p.amountMinor) / max * 100)}%` }} />)}</div><div className="mt-2 flex justify-between text-[10px] text-muted"><span>{selected.points[0].day}</span><span>{selected.points.at(-1)?.day}</span></div><details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Daily amounts · {selected.currency}</summary><table className="mt-2 w-full text-left"><caption className="sr-only">Signed payments by organization-local day, separate currency</caption><thead><tr><th scope="col">Local date</th><th scope="col">Amount recorded</th></tr></thead><tbody>{selected.points.map(p => <tr key={p.day}><td className="py-1">{p.day}</td><td className="tabular-nums">{formatMoney(p.amountMinor, selected.currency)}</td></tr>)}</tbody></table></details></div>;
}
const subscribePreferences = (callback: () => void) => { window.addEventListener('storage', callback); window.addEventListener('home-preferences', callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener('home-preferences', callback); }; };
function usePreferences(key: string) {
  const raw = useSyncExternalStore(subscribePreferences, () => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }, () => '');
  const hidden: string[] = (() => { try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && ['performance', 'activity'].includes(v)) : []; } catch { return []; } })();
  const toggle = (panel: string) => { try { localStorage.setItem(key, JSON.stringify(hidden.includes(panel) ? hidden.filter(v => v !== panel) : [...hidden, panel])); window.dispatchEvent(new Event('home-preferences')); } catch { /* Blocked storage leaves the default layout intact. */ } };
  return { hidden, toggle };
}
/**
 * Choosing which of two panels Home shows is a small, passing choice tied to one control, so it is a
 * popover anchored to Customize rather than a full-height drawer. Each change applies at once and is
 * saved in this browser; Escape or clicking away closes it and returns focus to Customize.
 */
export function CustomizeHome({ hidden, toggle }: { hidden: string[]; toggle: (panel: string) => void }) {
  return <Popover><PopoverTrigger asChild><Button tone="secondary" size="small"><Settings2 aria-hidden className="size-4" />Customize</Button></PopoverTrigger>
    <PopoverContent align="end" aria-labelledby="customize-home-title" className="grid gap-3">
      <div><h2 id="customize-home-title" className="text-sm font-semibold">Customize Home</h2><p className="mt-1 text-xs text-muted">Choose the panels shown on Home. Saved in this browser.</p></div>
      <fieldset className="grid gap-2"><legend className="sr-only">Panels shown on Home</legend>{[['performance', 'Business performance'], ['activity', 'Recent activity']].map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 rounded border border-border px-3 text-sm"><input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</fieldset>
    </PopoverContent></Popover>;
}
const attentionFilters: { label: string; scope: HomeQuery['scope']; attention: HomeQuery['attention'] }[] = [{ label: 'All', scope: 'organization', attention: 'all' }, { label: 'Mine', scope: 'mine', attention: 'all' }, { label: 'Urgent', scope: 'organization', attention: 'urgent' }, { label: 'Overdue', scope: 'organization', attention: 'overdue' }];

const subscribeTimezone = () => () => {};
export function HomeDashboard({ data, setup }: { data: HomeData; setup?: ReactNode }) {
  const router = useRouter(), [refreshing, refresh] = useTransition(), [expanded, setExpanded] = useState(false);
  const { toggleAgent } = useWorkspaceRail();
  const commands = useHomeCommands(), publish = commands?.publish;
  useEffect(() => { publish?.(data); }, [data, publish]);
  const browserTimezone = useSyncExternalStore(subscribeTimezone, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => data.timezone);
  const preferences = usePreferences(`gildops:home:v1:${data.organizationId}:${data.membershipId}`);
  const sources = data.results.flatMap(result => result.state === 'ready' ? [result.data] : []), unavailable = data.results.filter(result => result.state === 'unavailable');
  const dayEnd = zonedDayRange(data.date, data.timezone).endsAt;
  const attention = prioritize(sources.flatMap(source => source.attention), dayEnd), mine = prioritize(sources.flatMap(source => source.priorities), dayEnd).slice(0, 3);
  const categories = sources.flatMap(source => source.categories), performance = sources.flatMap(source => source.performance);
  const today = sources.flatMap(source => source.today).sort((a,b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
  const upcoming = [...today, ...sources.flatMap(source => source.upcoming)].sort((a,b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
  const activity = [...new Map(sources.flatMap(source => source.activity).map(item => [item.key,item])).values()].sort((a,b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key)).slice(0, 10);
  const href = (change: Partial<HomeQuery>) => `/organizations/${data.organizationId}/home?${new URLSearchParams({ ...data.query, ...change })}`;
  const createHref = data.quickActions.find(action => action.key === 'work')?.href;
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(data.refreshedAt)));
  const greeting = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${commands?.displayName ? `, ${commands.displayName.split(' ')[0]}` : ''}`;
  return <AppPage className="@container/home space-y-4">
    {setup}
    <PageHeader title={greeting} breadcrumbLabel="Home" meta={<><time dateTime={data.date}>{new Intl.DateTimeFormat('en-CA', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${data.date}T12:00:00Z`))}</time>{browserTimezone !== data.timezone ? ` | ${data.timezone}` : ''}</>} actions={<>
      <CustomizeHome hidden={preferences.hidden} toggle={preferences.toggle} />
      <QuickActions actions={data.quickActions}/>
    </>} />
    <div className="flex flex-wrap items-center justify-between gap-2">{commands && data.agentPrompts.length ? <Button tone="secondary" size="small" onClick={commands.openSearch}>Ask or find something...</Button> : <span/>}<Button tone="ghost" size="small" aria-label="Refresh Home" disabled={refreshing} onClick={() => refresh(() => router.refresh())}><time dateTime={data.refreshedAt} className="text-xs text-muted">Updated {timestamp(data.refreshedAt, data.timezone, true)}</time><RefreshCw aria-hidden className={cx('size-3', refreshing && 'animate-spin')}/></Button></div>
    {data.kpis.length ? <div className="grid grid-cols-2 gap-3 @min-[60rem]/home:grid-cols-4">{data.kpis.map(metric => <Link key={metric.key} href={metric.href} title={metric.definition} data-slot="metric-tile" className={cx('min-w-0 rounded-lg border border-border bg-surface p-4 transition hover:bg-hover', FOCUS_RING)}><div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{metric.label}</span><ArrowRight aria-hidden className="size-3 shrink-0" /></div><p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{metric.value}</p></Link>)}</div> : null}
    <div className="grid items-start gap-4 @min-[64rem]/home:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <OperationalPanel body="edge-to-edge" title="Needs attention" icon={CircleAlert} action={<div className="flex flex-wrap gap-1" role="group" aria-label="Attention filters">{attentionFilters.map(filter => <Link key={filter.label} href={href({ scope: filter.scope, attention: filter.attention })} aria-current={data.query.scope === filter.scope && data.query.attention === filter.attention ? 'page' : undefined} className={cx('rounded px-2 py-1 text-xs', data.query.scope === filter.scope && data.query.attention === filter.attention ? 'bg-selected font-medium' : 'text-muted hover:bg-hover', FOCUS_RING)}>{filter.label}</Link>)}</div>}>
        {unavailable.length ? <div role="alert" className="border-b border-border bg-warning/10 px-4 py-3 text-xs"><p className="font-medium">Some sources are temporarily unavailable</p><p className="mt-1">{unavailable.map(source => source.source).join(', ')} could not load. Refresh to try again.</p></div> : null}
        {categories.some(category => category.total > 0) ? <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-border px-4 py-3">{categories.filter(category => category.total > 0).map(category => <Link key={category.key} href={category.href} className={cx('rounded text-xs hover:underline', FOCUS_RING)}><strong className="tabular-nums">{category.total}</strong> {category.label}</Link>)}</div> : null}
        {attention.length ? <AttentionRows rows={expanded ? attention : attention.slice(0, 8)} timezone={data.timezone} agent={toggleAgent} /> : <PanelState kind={unavailable.length ? 'unavailable' : 'empty'}>{unavailable.length ? 'No items from the sources that loaded.' : data.query.scope === 'mine' ? 'Nothing assigned to you needs attention.' : 'Nothing needs attention.'}</PanelState>}
        {attention.length > 8 ? <div className="border-t border-border px-4 py-2"><Button tone="text" size="tiny" onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse previews' : 'Expand previews'}<ChevronDown aria-hidden className="size-3" /></Button></div> : null}
      </OperationalPanel>
      <OperationalPanel body="edge-to-edge" title="My priorities" icon={ListTodo}><ol className="divide-y divide-border">{mine.length ? mine.map((row, index) => <li key={row.key}><Link href={row.destination.href} className={cx('flex items-start gap-3 px-4 py-3 hover:bg-hover', FOCUS_RING)}><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs">{index+1}</span><div className="min-w-0"><p className="break-words text-sm font-medium">{row.title}</p><p className="mt-1 text-[11px] text-muted">{row.source} | {row.dueAt ? timestamp(row.dueAt, data.timezone) : row.description}</p></div></Link></li>) : <li><PanelState>{unavailable.length ? 'No assignments from the sources that loaded.' : 'You are all caught up.'}</PanelState></li>}</ol><Link href={href({ scope: 'mine', attention: 'all' })} className={cx('block border-t border-border px-4 py-2.5 text-xs hover:underline', FOCUS_RING)}>View my workload</Link></OperationalPanel>
      <OperationalPanel body="edge-to-edge" title="Schedule" icon={CalendarClock}><Tabs defaultValue="today"><TabsList className="m-3" aria-label="Schedule period"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="week">Next 7 days</TabsTrigger></TabsList><TabsContent value="today"><Obligations rows={today.slice(0, 8)} timezone={data.timezone} today incomplete={unavailable.some(source => ['Work', 'CRM', 'Support'].includes(source.source))} createHref={createHref}/></TabsContent><TabsContent value="week"><Obligations rows={upcoming.slice(0, 8)} timezone={data.timezone} incomplete={unavailable.some(source => ['Work', 'CRM', 'Support'].includes(source.source))} createHref={createHref}/></TabsContent></Tabs></OperationalPanel>
      {!preferences.hidden.includes('performance') ? <OperationalPanel body="edge-to-edge" title="Business performance" icon={TrendingUp} action={<ViewNav label="Reporting period" current={data.query.when} className="mb-0" views={(['today', 'week', 'month'] as const).map(when => ({ key: when, href: href({ when }), label: when === 'today' ? 'Today' : when === 'week' ? 'Last 7 days' : 'This month' }))} />}><div className="grid grid-cols-2">{performance.length ? performance.map(metric => <Link key={metric.key} href={metric.href} title={metric.definition} className={cx('min-w-0 border-b border-border px-4 py-4 hover:bg-hover', FOCUS_RING)}><p className="text-xs text-muted">{metric.label}</p><p className="mt-2 break-words text-xl font-semibold tabular-nums">{metric.value}</p>{['customers', 'Outstanding invoices'].some(key => metric.key.startsWith(key)) ? <p className="mt-1 text-[11px] text-muted">Current total</p> : null}</Link>) : <PanelState>No performance data for this period.</PanelState>}</div><PaymentTrend trends={sources.flatMap(source => source.trends)} /></OperationalPanel> : null}
    </div>
    {!preferences.hidden.includes('activity') ? <OperationalPanel body="edge-to-edge" title="Recent activity" icon={Activity}><ul className="divide-y divide-border">{activity.length ? activity.map(item => <li key={item.key}><Link href={item.href} className={cx('flex flex-wrap items-start justify-between gap-2 px-4 py-3 hover:bg-hover', FOCUS_RING)}><div className="min-w-0"><p className="break-words text-sm">{item.title}</p><p className="mt-1 text-[11px] text-muted">{item.source}</p></div><time className="text-[11px] text-muted" dateTime={item.at}>{timestamp(item.at, data.timezone)}</time></Link></li>) : <li><PanelState>No recent activity.</PanelState></li>}</ul></OperationalPanel> : null}
  </AppPage>;
}
