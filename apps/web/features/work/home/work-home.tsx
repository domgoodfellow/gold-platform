import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarDays, CircleCheck, ClipboardList, Hourglass, Route, ShieldCheck } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { PeriodField } from '@/components/controls/period-field';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { CompactEmptyState, MetricTile, OperationalPanel } from '@/components/operational/primitives';
import { AttentionCategories, type AttentionCategory } from '@/components/operational/attention-categories';
import { DashboardLayoutGrid, type DashboardWidgetContent } from '@/components/dashboard/dashboard-layout';
import { defaultLayout } from '@/lib/dashboard-layout';
import { NewWorkAction } from '../new-work-action';
import { formatWindow, shiftDate } from '@/lib/domain/scheduling/window';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import type { WorkOperations } from '@/lib/application/work/operations';
import { readableWorkWidgets, scheduledVolumeChart, schedulesWork, workSetupStep, WORK_WIDGETS, type WorkSetupStep } from '@/lib/application/work/dashboard';

const DEFAULT_LAYOUT = { layout: defaultLayout(WORK_WIDGETS), revision: 0, customized: false };

/**
 * Work Dashboard at `/field`, in reading order: Work overview (the selected day's scheduled work,
 * the unassigned and unscheduled backlogs, requirement coverage), Needs attention beside the
 * selected day's schedule, scheduled-work volume beside dispatch capacity, then Upcoming and recent
 * activity. Every figure is `workOperations`'; nothing is counted twice or stored. The header holds
 * one date control, Configure, Dispatch and New work last; the workspace bar already names the page.
 * A business that cannot show work yet keeps the overview slot with the one missing step and its
 * action. Work that is never scheduled is never asked for a date, a resource or a schedule.
 */
export function WorkHome({ organizationId, timezone, today, data: d, capabilities, activity, configure }: {
  organizationId: string; timezone: string; today: string; data: WorkOperations; capabilities: readonly string[];
  activity: ReactNode; configure?: ReactNode;
}) {
  const base = `/organizations/${organizationId}`;
  const may = (capability: string) => capabilities.includes(capability);
  const dispatch = `${base}/work/dispatch`;
  const onDay = `${dispatch}?on=${d.date}`;
  const step = workSetupStep(d);
  const scheduling = !step && schedulesWork(d);
  const isToday = d.date === today;
  const dayName = isToday ? 'Today' : new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${d.date}T12:00:00Z`));
  const when = (w: WorkItem) => w.window ? formatWindow(w.window, timezone) : w.type.label;
  const time = (instant: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
  const people = (w: WorkItem) => w.resources.map(r => r.label).join(', ') || 'Unassigned';
  const shortfallText = (id: string) => d.coverage[id]?.shortfall ?? null;

  const actions = <>
    {scheduling ? <PeriodField action={`${base}/field`} name="on" type="date" label="Work date" value={d.date} /> : null}
    {configure}
    {scheduling ? <ButtonLink size="small" tone="secondary" href={onDay} aria-label="Dispatch"><Route aria-hidden className="size-4" /><span className="max-sm:sr-only">Dispatch</span></ButtonLink> : null}
    {!step && may('work_item.create') ? <NewWorkAction organizationId={organizationId} /> : null}
  </>;

  const met = d.todayCount - d.shortfalls.total;
  const overview = <section aria-label="Work overview" className="@container min-w-0">
    {step ? <GettingStarted organizationId={organizationId} step={step} capabilities={capabilities} />
      : <div className="grid min-w-0 grid-cols-2 gap-3 @min-[60rem]:grid-cols-4">
        {scheduling ? <>
          <MetricTile label="Scheduled" icon={CalendarDays} value={d.todayCount} detail={isToday ? 'Today' : `On ${dayName}`} href={`${base}/schedule?on=${d.date}&view=day`} />
          <MetricTile label="Unassigned" icon={ClipboardList} value={d.unassigned.total} detail="Scheduled with no resource" href={`${dispatch}?assignment=unassigned`} emphasis={d.unassigned.total ? 'warning' : undefined} />
          <MetricTile label="Unscheduled" icon={Hourglass} value={d.unscheduled.total} detail="Waiting for a time" href={`${dispatch}?assignment=unscheduled`} />
          <MetricTile label="Requirements met" icon={ShieldCheck} value={d.todayCount ? `${met} of ${d.todayCount}` : <span className="text-sm font-normal leading-8 text-muted">Nothing scheduled</span>}
            detail={d.todayCount ? `Resource coverage, ${isToday ? 'today' : dayName}` : undefined} href={`${onDay}&assignment=shortfall`} emphasis={d.shortfalls.total ? 'danger' : undefined} />
        </> : <MetricTile label="Active work" icon={ClipboardList} value={d.active} detail={`${d.recorded} recorded in all`} href={`${base}/work`} />}
      </div>}
  </section>;

  const row = (w: WorkItem, value: string, tone?: 'danger') => ({ id: w.id, href: `${base}/work/${w.id}`, title: w.title, detail: [w.customer?.label, when(w)].filter(Boolean).join(' · '), value, tone });
  const categories: AttentionCategory[] = [
    { key: 'unassigned', label: 'Unassigned', count: d.unassigned.total, href: `${dispatch}?assignment=unassigned`, rows: d.unassigned.map(w => row(w, 'No resource', 'danger')) },
    { key: 'shortfall', label: 'Requirement gaps', count: d.shortfalls.total, href: `${onDay}&assignment=shortfall`, rows: d.shortfalls.map(w => row(w, shortfallText(w.id) ?? 'Requirement not met', 'danger')) },
    { key: 'conflict', label: 'Availability', count: d.conflicts.total, href: `${onDay}&assignment=conflict`, rows: d.conflicts.map(w => row(w, 'Outside availability', 'danger')) },
    { key: 'unscheduled', label: 'Unscheduled', count: d.unscheduled.total, href: `${dispatch}?assignment=unscheduled`, rows: d.unscheduled.map(w => row(w, w.status.label)) },
  ].filter(category => category.count > 0);
  const attention = categories.length
    ? <OperationalPanel className="h-full min-w-0" title="Needs attention"><AttentionCategories categories={categories} /></OperationalPanel>
    : <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"><CircleCheck aria-hidden className="size-4 shrink-0 text-muted" /><span><span className="font-medium">Needs attention:</span> every scheduled job has its resources, nothing is outside availability{isToday ? ' today' : ` on ${dayName}`}, and nothing is waiting for a time.</span></p>;

  const schedule = <OperationalPanel className="h-full min-w-0" density="compact" title={dayName} count={d.todayCount} href={`${base}/schedule?on=${d.date}&view=day`} hrefLabel={d.todayCount > d.today.length ? `View all ${d.todayCount}` : 'Schedule'}>
    {d.today.length ? <ol className="divide-y divide-border">{d.today.map(w => <li key={w.id} className="flex gap-3 py-2">
      <time dateTime={w.window?.startsAt} className="w-12 shrink-0 pt-px text-xs tabular-nums text-muted">{w.window ? time(w.window.startsAt) : ''}</time>
      <div className="min-w-0 flex-1"><Link className="block truncate text-sm font-medium hover:underline" href={`${base}/work/${w.id}`}>{w.title}</Link>
        <p className="truncate text-xs text-muted">{[w.customer?.label, people(w), w.status.label].filter(Boolean).join(' · ')}</p>
        {shortfallText(w.id) ? <p className="text-xs text-danger">{shortfallText(w.id)}</p> : null}</div>
    </li>)}</ol> : <CompactEmptyState>Nothing is scheduled {isToday ? 'today' : `on ${dayName}`}.</CompactEmptyState>}
  </OperationalPanel>;

  const free = d.day.resources.filter(r => r.free.length);
  const capacity = <OperationalPanel className="h-full min-w-0" density="compact" title="Dispatch capacity" href={onDay} hrefLabel="Open dispatch">
    {d.setup.resources === 0 ? <CompactEmptyState kind="not-configured" action={may('resource.create') ? <ButtonLink size="small" tone="secondary" href={`${base}/resources`}>Add resources</ButtonLink> : undefined}>No resources yet. Scheduled work is assigned to the people, vehicles or equipment that do it.</CompactEmptyState>
      : <>
        <p className="text-sm"><span className="font-semibold tabular-nums">{free.length} of {d.day.resources.length}</span> resources have free time{d.openHours > 0 ? <> · <span className="tabular-nums">{d.freeHours.toFixed(1)} of {d.openHours.toFixed(1)}</span> open hours free</> : null}</p>
        {!d.hoursConfigured ? <p className="mt-1 text-xs text-muted">Opening hours are not set, so every resource counts as available all day.</p> : null}
        <ul className="mt-2 divide-y divide-border text-sm">{d.day.resources.slice(0, 5).map(r => <li key={r.resource.id} className="flex items-baseline justify-between gap-3 py-2">
          <Link className="min-w-0 truncate font-medium hover:underline" href={`${base}/resources/${r.resource.id}`}>{r.resource.name}</Link>
          <span className="shrink-0 text-right text-xs text-muted">{r.booked.length} {r.booked.length === 1 ? 'job' : 'jobs'} · {r.free[0] ? `free ${time(r.free[0].startsAt)}–${time(r.free[0].endsAt)}${r.free.length > 1 ? ` +${r.free.length - 1}` : ''}` : r.exceptions.length ? 'time off' : 'no free time'}</span>
        </li>)}</ul>
        {d.day.resources.length > 5 ? <p className="mt-1 text-xs text-muted">{d.day.resources.length - 5} more on the dispatch board.</p> : null}
      </>}
  </OperationalPanel>;

  const next = shiftDate(d.date, 1);
  const upcoming = <OperationalPanel className="h-full min-w-0" density="compact" title="Upcoming" count={d.upcoming.total} href={`${dispatch}?assignment=upcoming&on=${next}`} hrefLabel={d.upcoming.total > d.upcoming.length ? `View all ${d.upcoming.total}` : 'View all'}>
    {d.upcoming.length ? <ul className="divide-y divide-border">{d.upcoming.map(w => <li key={w.id} className="py-2">
      <Link className="block truncate text-sm font-medium hover:underline" href={`${base}/work/${w.id}`}>{w.title}</Link>
      <p className="truncate text-xs text-muted">{[when(w), w.customer?.label, people(w)].filter(Boolean).join(' · ')}</p>
    </li>)}</ul> : <CompactEmptyState>Nothing is scheduled in the seven days after {isToday ? 'today' : dayName}.</CompactEmptyState>}
  </OperationalPanel>;

  const volume = scheduledVolumeChart(d.history, d.date, day => `${base}/schedule?on=${day}&view=day`);
  const readable = readableWorkWidgets(d);
  const widgets: Record<string, DashboardWidgetContent> = {
    overview: { kind: 'node', node: overview },
    attention: { kind: 'node', node: attention },
    today: { kind: 'node', node: schedule },
    volume: { kind: 'chart', title: 'Scheduled work', variants: [{ key: 'jobs', label: 'Jobs', data: volume }], state: d.history.some(h => h.count) ? undefined : { status: 'empty', message: 'No work was scheduled in these seven days.' } },
    capacity: { kind: 'node', node: capacity },
    upcoming: { kind: 'node', node: upcoming },
    activity: { kind: 'node', node: <OperationalPanel className="h-full min-w-0" density="compact" title="Recent activity" href={`${base}/work`} hrefLabel="Work items">{activity}</OperationalPanel> },
  };
  return <WorkspaceHome location={{}} actions={actions}>
    <DashboardLayoutGrid label="Work dashboard" registry={WORK_WIDGETS} saved={DEFAULT_LAYOUT} readable={[...readable]} widgets={widgets} />
  </WorkspaceHome>;
}

/**
 * The one missing step and its action, in the overview slot: no type, a type with no starting
 * stage, or no work yet. Someone without the authority sees what is missing and who can add it.
 */
function GettingStarted({ organizationId, step, capabilities }: { organizationId: string; step: NonNullable<WorkSetupStep>; capabilities: readonly string[] }) {
  const base = `/organizations/${organizationId}`;
  const configure = capabilities.includes('field.manage');
  const [title, text, action] = step.kind === 'no-types'
    ? ['No work types yet', 'Work types name the jobs this business does and the stages each one moves through.',
      configure ? <ButtonLink size="small" tone="primary" href={`${base}/work/configuration`}>Set up work types</ButtonLink> : <p className="text-sm text-muted">Someone who manages Work sets up work types.</p>]
    : step.kind === 'no-starting-stage'
      ? [`${step.typeName} has no starting stage`, 'Work of this type can be created once it has a first stage.',
        configure ? <ButtonLink size="small" tone="primary" href={`${base}/work/configuration?type=${step.typeId}`}>Add a starting stage</ButtonLink> : <p className="text-sm text-muted">Someone who manages Work adds the starting stage.</p>]
      : ['No work yet', 'Work you create appears here, with anything that needs attention.',
        capabilities.includes('work_item.create') ? <NewWorkAction organizationId={organizationId} typeId={step.typeId} /> : <p className="text-sm text-muted">Someone who can create work adds the first job.</p>];
  return <div data-slot="compact-empty" className="flex flex-col gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-muted">{text}</p></div>
    <div className="shrink-0">{action}</div>
  </div>;
}
