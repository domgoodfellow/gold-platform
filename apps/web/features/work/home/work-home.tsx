import { NavigationList } from '@/components/navigation/navigation-list';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarDays, Users, ClipboardList, ShieldCheck } from 'lucide-react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { WorkCreateDrawer, type WorkCreateOptions } from '../work-create-drawer';
import { MetricTile, OperationalPanel } from '@/components/operational/primitives';
import { WorkAttention } from './attention';
import type { WorkOperations } from '@/lib/application/work/operations';

export function WorkHome({ organizationId, timezone, data: d, createOptions, shortcuts, activity, configure }: {
  configure?: ReactNode;
  organizationId: string; timezone: string; data: WorkOperations; createOptions: WorkCreateOptions | null;
  /** Manage Work's links, chosen from the authorized navigation projection (`workspaceShortcuts`); never a list of its own. */
  shortcuts: readonly { key: string; label: string; href: string }[]; activity: ReactNode;
}) {
  const base = `/organizations/${organizationId}`;
  const dispatch = `${base}/work/dispatch?on=${d.date}`;
  const schedule = `${base}/schedule?on=${d.date}&view=day`;
  const shortfalls = Object.fromEntries(Object.entries(d.coverage).flatMap(([id, c]) => c.shortfall ? [[id, c.shortfall]] : []));
  const kpis = [
    { label: 'Scheduled work', value: d.todayCount, note: `${d.date} · committed work`, href: schedule, icon: CalendarDays },
    { label: 'Resources available', value: `${d.available} of ${d.day.resources.length}`, note: d.hoursConfigured ? 'Have a free window on this day' : 'Opening hours not configured', href: `${base}/resources?on=${d.date}`, icon: Users },
    { label: 'Assignment backlog', value: d.unassigned.total, note: 'Scheduled work with no resource', href: `${base}/work/dispatch?assignment=unassigned`, icon: ClipboardList },
    { label: 'Requirements met', value: `${d.todayCount - d.shortfalls.total} / ${d.todayCount}`, note: 'Selected day · resource coverage', href: `${dispatch}&assignment=shortfall`, icon: ShieldCheck },
  ];
  const groups = [
    { key: 'unassigned', label: 'Unassigned scheduled', count: d.unassigned.total, rows: d.unassigned, href: `${base}/work/dispatch?assignment=unassigned` },
    { key: 'unscheduled', label: 'Unscheduled', count: d.unscheduled.total, rows: d.unscheduled, href: `${base}/work/dispatch?assignment=unscheduled` },
    { key: 'shortfall', label: 'Missing resources · day', count: d.shortfalls.total, rows: d.shortfalls, href: `${dispatch}&assignment=shortfall`, issues: shortfalls },
    { key: 'conflict', label: 'Availability · day', count: d.conflicts.total, rows: d.conflicts, href: `${dispatch}&assignment=conflict`, issues: Object.fromEntries(d.conflicts.map(w => [w.id, 'Outside resource availability'])) },
  ];
  const time = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant));
  return <AppPage className="space-y-3">
    <PageHeader title="Work" meta={<span>{d.date} · {timezone}</span>} actions={<>
      <form method="get" className="flex items-center gap-1"><TextInput type="date" name="on" aria-label="Work date" defaultValue={d.date} className="w-36"/><Button size="small" tone="text">Apply</Button></form>
      {createOptions ? <WorkCreateDrawer options={createOptions}/> : null}<ButtonLink tone="secondary" href={dispatch}>Dispatch board</ButtonLink>
      {configure}
    </>}/>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(k => <MetricTile key={k.label} label={k.label} value={k.value} detail={k.note} icon={k.icon} href={k.href}/>)}</div>
    <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
      <div className="min-w-0 space-y-3">
        <OperationalPanel density="compact" flush title="Needs attention"><WorkAttention organizationId={organizationId} timezone={timezone} groups={groups}/></OperationalPanel>
        <OperationalPanel density="compact" flush title="Dispatch overview" count={d.day.resources.length} href={dispatch} hrefLabel="View full dispatch board">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border bg-secondary text-muted"><tr>{['Resource', 'Assigned work', 'Free windows', 'Availability', 'Action'].map(h => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{d.day.resources.slice(0, 5).map(r => <tr key={r.resource.id}><td className="min-w-32 px-3 py-3 font-medium"><Link href={`${base}/resources/${r.resource.id}`}>{r.resource.name}</Link></td><td className="min-w-40 px-3 py-2">{r.booked.length ? <><Link className="hover:underline" href={`${dispatch}&selected=${r.booked[0].workItemId}`}>{r.booked[0].title}</Link><div className="mt-0.5 text-[11px] text-muted">{r.booked.length} committed work item{r.booked.length === 1 ? '' : 's'}</div></> : <span className="text-muted">No assigned work this day</span>}</td><td className="min-w-32 px-3 py-2 tabular-nums text-muted">{r.free[0] ? <>{time(r.free[0].startsAt)}–{time(r.free[0].endsAt)}{r.free.length > 1 ? ` +${r.free.length - 1}` : ''}</> : 'No free windows'}</td><td className="px-3 py-2"><span className={`whitespace-nowrap rounded-md px-2 py-1 ${r.free.length ? 'bg-success/10 text-success' : 'bg-surface text-muted'}`}>{r.free.length ? 'Capacity available' : r.exceptions.length ? 'Exception / time off' : 'No capacity'}</span></td><td className="px-3 py-2"><Link className="text-accent" href={`${base}/schedule?view=day&on=${d.date}&resource=${r.resource.id}`}>Schedule</Link></td></tr>)}{!d.day.resources.length ? <tr><td colSpan={5} className="px-3 py-7 text-center text-muted">No resources yet. <Link className="text-accent" href={`${base}/resources`}>Manage resources</Link></td></tr> : null}</tbody></table></div>
        </OperationalPanel>
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(220px,2fr)]"><OperationalPanel density="compact" flush title="Upcoming work" count={d.upcoming.total} href={`${dispatch}&assignment=upcoming`} hrefLabel="View work"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border bg-secondary text-muted"><tr>{['Work / Customer', 'Time', 'Status', ''].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{d.upcoming.map(w => <tr key={w.id}><td className="px-3 py-2"><Link className="block max-w-44 truncate font-medium" href={`${base}/work/${w.id}`}>{w.title}</Link><span className="block max-w-44 truncate text-[11px] text-muted">{w.customer?.label ?? 'No customer'} · {w.resources.map(r => r.label).join(', ') || 'Unassigned'}</span></td><td className="whitespace-nowrap px-3 py-2 text-muted">{w.window ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(w.window.startsAt)) : 'Unscheduled'}</td><td className="px-3 py-2"><span className="rounded bg-surface px-2 py-1 text-[11px]">{w.status.label}</span></td><td className="px-3 py-2"><Link href={`${base}/work/${w.id}`} className="text-accent">Open</Link></td></tr>)}{!d.upcoming.length ? <tr><td colSpan={4} className="px-3 py-7 text-center text-muted">No committed work in the next seven days.</td></tr> : null}</tbody></table></div></OperationalPanel>
        <OperationalPanel density="compact" flush title="Scheduling performance"><div className="px-3 pb-3"><p className="text-xs text-muted">Committed work · seven days ending {d.date}</p><div className="mt-3 grid grid-cols-7 gap-1 xl:grid-cols-1">{d.history.map(h => <div key={h.date} className="rounded-md bg-surface/60 p-2 text-center text-xs xl:grid xl:grid-cols-[3rem_1.5rem_minmax(0,1fr)] xl:items-center xl:gap-2 xl:p-1 xl:text-left"><div className="text-muted">{h.date.slice(5)}</div><div className="my-1 text-lg font-semibold tabular-nums xl:my-0 xl:text-xs">{h.count}</div><meter aria-label={`Scheduled work ${h.date}`} min={0} max={Math.max(1, ...d.history.map(x => x.count))} value={h.count} className="h-2 w-full accent-accent"/></div>)}</div><p className="mt-2 text-[11px] text-muted">Current commitments by day; released work excluded.</p></div></OperationalPanel></div>
      </div>
      <aside className="min-w-0 space-y-3">
        <OperationalPanel density="compact" flush title="Today" count={d.todayCount} href={`${base}/field/calendar?on=${d.date}`} hrefLabel="View calendar"><p className="px-3 pb-1 text-[11px] text-muted">{d.date}</p><ol className="divide-y divide-border px-3">{d.today.map(w => <li key={w.id} className="flex gap-2 py-2"><time className="w-16 shrink-0 text-xs tabular-nums text-muted">{w.window ? time(w.window.startsAt) : ''}</time><div className="min-w-0 border-l-2 border-accent/30 pl-3"><Link className="block truncate text-xs font-medium hover:underline" href={`${base}/work/${w.id}`}>{w.title}</Link><p className="truncate text-[11px] text-muted" title={`${w.customer?.label ?? 'No customer'} · ${w.location?.label ?? 'No location'} · ${w.resources.map(r => r.label).join(', ') || 'Unassigned'} · ${w.status.label}`}>{w.customer?.label ?? 'No customer'} · {w.resources.map(r => r.label).join(', ') || 'Unassigned'} · {w.status.label}</p></div></li>)}</ol>{!d.today.length ? <p className="px-3 py-7 text-center text-xs text-muted">No committed work on this day.</p> : null}{d.todayCount > d.today.length ? <Link href={schedule} className="block px-3 pb-3 text-xs text-accent">View all {d.todayCount} scheduled jobs</Link> : null}</OperationalPanel>
        <OperationalPanel density="compact" flush title="Work status"><dl className="divide-y divide-border px-3 text-xs">{[['Active work', d.active], ['Scheduled on selected day', d.todayCount], ['Unscheduled backlog', d.unscheduled.total], ['Unassigned scheduled work', d.unassigned.total], ['Requirement gaps · day', d.shortfalls.total], ['Availability conflicts · day', d.conflicts.total]].map(([label, value]) => <div key={label} className="flex justify-between gap-2 py-2"><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl></OperationalPanel>
        <OperationalPanel density="compact" flush title="Recent activity" href={`${base}/work`} hrefLabel="View work"><div className="px-3 pb-2">{activity}</div></OperationalPanel>
        <OperationalPanel density="compact" flush title="Insights"><div className="grid grid-cols-2 gap-2 px-3 pb-3"><div className="rounded-md border border-border p-2"><p className="text-[11px] text-muted">Free resource hours · day</p><p className="mt-1 text-xl font-semibold tabular-nums">{d.freeHours.toFixed(1)}</p></div><div className="rounded-md border border-border p-2"><p className="text-[11px] text-muted">Open resource hours · day</p><p className="mt-1 text-xl font-semibold tabular-nums">{d.openHours.toFixed(1)}</p></div></div><p className="px-3 pb-3 text-[11px] text-muted">{d.hoursConfigured ? 'Hours follow business and resource availability.' : 'Opening hours are not configured; availability currently permits the full day.'}</p></OperationalPanel>
        <OperationalPanel density="compact" flush title="Manage Work"><NavigationList label="Work shortcuts" density="compact" className="grid-cols-2 px-3 pb-3" items={shortcuts.map((shortcut) => ({ key: shortcut.key, title: shortcut.label, href: shortcut.href }))} /></OperationalPanel>
      </aside>
    </div>
  </AppPage>;
}
