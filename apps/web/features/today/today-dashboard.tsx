import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { DividedList, EmptyState } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { Widget, WidgetGrid, WidgetPanel } from '@/components/display/widget';
import type { AutomationRun } from '@/lib/domain/automation/rules';
import type { MessageDelivery } from '@/lib/domain/automation/templates';
import type { Call } from '@/lib/domain/reception/calls';
import { areaLabel } from '@/lib/navigation';
import { formatWindow, type Window } from '@/lib/domain/scheduling/window';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { WorkItem } from '@/lib/domain/work-items/work-items';

const PREVIEW = 4;
type Commitment = { workItemId: string; title: string; window: Window; occupied: Window; resource: string };

/** `date` is already the organization's calendar date; formatting it must not shift it again. */
function formatBusinessDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function TodayDashboard({ organizationId, timezone, date, typesConfigured, open, committed, unscheduled, workItems, activity, failedRuns, failedMessages, todaysCalls, unwrittenCalls, automationsOn, receptionOn }: {
  organizationId: string;
  timezone: string;
  date: string;
  typesConfigured: boolean;
  open?: string;
  committed: Commitment[];
  unscheduled: WorkItem[];
  workItems: WorkItem[];
  activity: TimelineEntry[];
  failedRuns: AutomationRun[];
  failedMessages: MessageDelivery[];
  todaysCalls: Call[];
  unwrittenCalls: number;
  automationsOn: boolean;
  receptionOn: boolean;
}) {
  const area = `/organizations/${organizationId}/today`;
  const workHref = (id: string) => `/organizations/${organizationId}/work/${id}`;
  const byId = new Map(workItems.map((item) => [item.id, item]));

  const dateHeading = (
    <PageHeader
      title={areaLabel('today')}
      description={
        <>
          <time dateTime={date}>{formatBusinessDate(date)}</time> · Operational view for {timezone}
        </>
      }
    />
  );
  const committedTable = <DataTable rows={committed} rowKey={(row) => row.workItemId} empty="Nothing is scheduled for today." columns={[
    { key: 'title', header: 'Job', emphasis: 'primary', cell: (row) => <Link href={workHref(row.workItemId)} className="underline underline-offset-4">{row.title}</Link> },
    { key: 'window', header: 'When', cell: (row) => <span className="tabular-nums">{formatWindow(row.window, timezone)}</span> },
    { key: 'status', header: 'Stage', cell: (row) => { const label = byId.get(row.workItemId)?.status.label; return label ? <Badge>{label}</Badge> : null; } },
    { key: 'resource', header: 'Assigned', cell: (row) => row.resource },
    { key: 'where', header: 'Customer and location', emphasis: 'secondary', cell: (row) => { const item = byId.get(row.workItemId); return [item?.customer?.label, item?.location?.label].filter(Boolean).join(' · ') || null; } },
  ]} />;
  const waitingTable = <DataTable rows={unscheduled} rowKey={(row) => row.id} empty="Nothing is waiting." columns={[
    { key: 'title', header: 'Job', emphasis: 'primary', cell: (row) => <Link href={workHref(row.id)} className="underline underline-offset-4">{row.title}</Link> },
    { key: 'status', header: 'Stage', cell: (row) => <Badge>{row.status.label}</Badge> },
    { key: 'customer', header: 'Customer', cell: (row) => row.customer?.label ?? null },
  ]} />;
  const activityTable = <DataTable rows={activity} rowKey={(row) => row.id} empty="No activity yet." columns={[
    { key: 'description', header: 'What happened', emphasis: 'primary', cell: (row) => row.description },
    { key: 'when', header: 'When', cell: (row) => <span className="tabular-nums">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(row.occurredAt))}</span> },
    { key: 'actor', header: 'Who', emphasis: 'secondary', cell: (row) => row.actorName ?? 'A former member' },
  ]} />;

  if (open === 'committed' || open === 'waiting' || open === 'activity') {
    const title = open === 'committed' ? 'Committed today' : open === 'waiting' ? 'Waiting to be scheduled' : 'Recent activity';
    return <AppPage width="full">{dateHeading}<div><WidgetPanel title={title} backHref={area} backLabel="Today">{open === 'committed' ? committedTable : open === 'waiting' ? waitingTable : activityTable}</WidgetPanel></div></AppPage>;
  }

  const committedWidget = <Widget key="committed" title="Committed today" value={committed.length} href={committed.length ? `${area}?widget=committed` : undefined}>{committed.length === 0 ? <EmptyState weight="subtle">Nothing is scheduled today. <Link href={`/organizations/${organizationId}/schedule`} className="underline underline-offset-4">Open the schedule</Link></EmptyState> : <DividedList className="text-sm">{committed.slice(0, PREVIEW).map((row) => <li key={row.workItemId} className="flex items-baseline gap-2 py-1.5"><span className="shrink-0 tabular-nums text-muted">{formatWindow(row.window, timezone)}</span><Link href={workHref(row.workItemId)} className="min-w-0 truncate underline underline-offset-4">{row.title}</Link></li>)}</DividedList>}</Widget>;
  const waitingWidget = <Widget key="waiting" title="Waiting to be scheduled" value={unscheduled.length} note={unscheduled.length ? 'No time, or nobody assigned' : undefined} href={unscheduled.length ? `${area}?widget=waiting` : undefined}>{unscheduled.length === 0 ? <EmptyState weight="subtle">Nothing is waiting.</EmptyState> : <DividedList className="text-sm">{unscheduled.slice(0, PREVIEW).map((item) => <li key={item.id} className="flex items-baseline gap-2 py-1.5"><Link href={workHref(item.id)} className="min-w-0 truncate underline underline-offset-4">{item.title}</Link><span className="ml-auto shrink-0 text-muted">{item.customer?.label}</span></li>)}</DividedList>}</Widget>;
  const activityWidget = <Widget key="activity" title="Recent activity" href={activity.length ? `${area}?widget=activity` : undefined} wide>{activity.length === 0 ? <EmptyState weight="subtle">No activity yet.</EmptyState> : <DividedList className="text-sm">{activity.slice(0, PREVIEW).map((entry) => <li key={entry.id} className="flex items-baseline gap-2 py-1.5"><span className="shrink-0 tabular-nums text-muted">{new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: timezone }).format(new Date(entry.occurredAt))}</span><span className="min-w-0 truncate">{entry.description}</span></li>)}</DividedList>}</Widget>;
  const automationWidgets = automationsOn ? [
    <Widget key="failed-automations" title="Failed automations" value={failedRuns.length} href={`/organizations/${organizationId}/automations`}>{failedRuns.length === 0 ? <EmptyState weight="subtle">No failures.</EmptyState> : <DividedList className="text-sm">{failedRuns.slice(0, PREVIEW).map((run) => <li key={run.id} className="py-1.5"><div className="truncate">{run.ruleName}</div>{run.detail ? <div className="truncate text-xs text-muted">{run.detail}</div> : null}</li>)}</DividedList>}</Widget>,
    <Widget key="failed-messages" title="Failed messages" value={failedMessages.length} href={`/organizations/${organizationId}/automations`}>{failedMessages.length === 0 ? <EmptyState weight="subtle">No failures.</EmptyState> : <DividedList className="text-sm">{failedMessages.slice(0, PREVIEW).map((message) => <li key={message.id} className="py-1.5"><div className="truncate">{message.channel} to {message.recipient}</div>{message.detail ? <div className="truncate text-xs text-muted">{message.detail}</div> : null}</li>)}</DividedList>}</Widget>,
  ] : [];
  const callsWidget = receptionOn ? <Widget key="calls" title="Calls" value={todaysCalls.length} note={unwrittenCalls ? `${unwrittenCalls} not written up` : undefined} href={`/organizations/${organizationId}/calls`}>{todaysCalls.length === 0 ? <EmptyState weight="subtle">No calls today.</EmptyState> : <DividedList className="text-sm">{todaysCalls.slice(0, PREVIEW).map((call) => <li key={call.id} className="flex items-baseline gap-2 py-1.5"><span className="min-w-0 truncate">{call.direction === 'inbound' ? 'Inbound' : 'Outbound'} · {call.toNumber}</span><span className="ml-auto shrink-0 text-muted">{call.outcome?.name ?? call.status.replace('_', ' ')}</span></li>)}</DividedList>}</Widget> : null;
  const operations = [committedWidget, waitingWidget, ...automationWidgets, callsWidget].filter(Boolean);
  return <AppPage width="full">{dateHeading}{!typesConfigured ? <EmptyState className="mb-5">No kinds of work are defined yet. <Link href={`/organizations/${organizationId}/work/configuration`} className="underline underline-offset-4">Configure work</Link></EmptyState> : null}<WidgetGrid>{operations}{activityWidget}</WidgetGrid></AppPage>;
}
