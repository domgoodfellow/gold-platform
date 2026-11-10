import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import { AppPage } from '@/components/layout/app-page';
import { Badge } from '@/components/display/data';
import { ButtonLink } from '@/components/controls/button';
import { PageHeader } from '@/components/headers/page-header';
import { CompactEmptyState, MetricTile, OperationalPanel } from '@/components/operational/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gold/ui/components/table';
import { ViewNav } from '@/components/navigation/view-nav';
import { CallHistory } from '@/features/communications/voice/call-history';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { callStatusLabel } from '@/lib/domain/reception/calls';
import type { InboxItem } from '@/lib/domain/reception/inbox';
import type { CommunicationsDashboard } from '@/lib/application/communications/dashboard';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { workspaceAncestry } from '@/lib/navigation';
import { ConversationActions, NewCallButton } from './communication-actions';
import { PeriodSelect } from '@/components/controls/period-select';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'Last 30 days' }] as const;
function Initials({ name }: { name: string }) {
  return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium text-muted">{name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>;
}
function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function ConversationPreview({ items, organizationId, timezone, query = '' }: { items: InboxItem[]; organizationId: string; timezone: string; query?: string }) {
  if (!items.length) return <CompactEmptyState>No conversations match this view.</CompactEmptyState>;
  return <ul className="divide-y divide-border">{items.map(item => {
    const Icon = item.channel === 'email' ? Mail : MessageSquare;
    const name = item.channel === 'sms' ? formatPhoneForDisplay(item.title) : item.title;
    return <li key={item.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
      <Link href={`/organizations/${organizationId}/comms/inbox/${item.id}${query}`} className="flex min-w-0 flex-1 items-start gap-3 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Initials name={name} />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="font-medium">{name}</span><time className="text-xs text-muted" dateTime={item.lastActivityAt}>{formatTime(item.lastActivityAt, timezone)}</time></span>
          {item.subject ? <span className="block truncate text-sm">{item.subject}</span> : null}
          <span className="block truncate text-sm text-muted">{item.preview || 'No message preview'}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span className="inline-flex items-center gap-1"><Icon aria-hidden className="size-3.5" />{item.channel === 'sms' ? 'SMS' : 'Email'}</span>{item.unread ? <span className="font-medium text-accent-text">Unread</span> : null}<span>{item.assignee?.name ?? 'Unassigned'}</span><span>{item.status === 'open' ? 'Open' : item.status === 'waiting' ? 'Waiting' : 'Closed'}</span></span>
        </span>
      </Link>
      <ConversationActions organizationId={organizationId} item={item} />
    </li>;
  })}</ul>;
}

export function CommunicationsHome({ organizationId, timezone, data, configure, setupHref }: {
  organizationId: string; timezone: string; data: CommunicationsDashboard; configure?: ReactNode; setupHref?: string;
}) {
  const base = `/organizations/${organizationId}`, home = `${base}/comms`, inbox = `${home}/inbox`, calls = `${base}/calls`;
  const { params, mayCall, mayMessage } = data;
  const link = (change: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, q: params.search, ...change })) if (value && key !== 'search') q.set(key, value);
    return `${home}?${q}`;
  };
  const inboxQuery = new URLSearchParams();
  if (params.queue === 'unassigned') inboxQuery.set('view', 'unassigned');
  else if (params.queue !== 'all') inboxQuery.set('status', params.queue);
  if (params.channel !== 'all') inboxQuery.set('channel', params.channel);
  if (params.search) inboxQuery.set('q', params.search);
  const inboxSuffix = inboxQuery.size ? `?${inboxQuery}` : '';
  const callSuffix = `?when=${params.when}${params.search ? `&q=${encodeURIComponent(params.search)}` : ''}`;
  const attentionTabs = [
    ...(mayCall ? [{ key: 'missed', label: 'Missed calls', count: data.missed?.total ?? 0 }, { key: 'wrap', label: 'Needs wrap-up', count: data.counts?.needsWrapUp ?? 0 }] : []),
    ...(mayMessage ? [{ key: 'unread', label: 'Unread', count: data.inboxCounts?.unread ?? 0 }, { key: 'unassigned', label: 'Unassigned', count: data.inboxCounts?.unassigned ?? 0 }] : []),
  ];
  const attention = attentionTabs.find(tab => tab.key === params.attention)?.key ?? attentionTabs.find(tab => tab.count > 0)?.key ?? attentionTabs[0]?.key;
  const attentionHref = attention === 'unread' || attention === 'unassigned' ? `${inbox}?view=${attention}` : attention === 'wrap' ? `${calls}?wrap=1#call-history` : `${calls}?state=missed&when=${params.when}#call-history`;
  const attentionCalls = attention === 'wrap' ? data.wrap?.items ?? [] : data.missed?.items ?? [];
  const period = PERIODS.find(entry => entry.value === params.when)?.label ?? 'Today';
  const blocker = data.callingBlocker;
  const noAttention = !attentionTabs.some(tab => tab.count > 0);

  return <AppPage data-communications-dashboard className="@container/comms space-y-3 pb-14 md:pb-0">
    <PageHeader title="Dashboard" crumbs={workspaceAncestry(organizationId, 'comms')} className="mb-0" actions={<>
      <PeriodSelect label="Communication date range" size="default" value={params.when} options={PERIODS.map(entry => ({ ...entry, href: link({ when: entry.value }) }))} />
      {mayMessage ? <ButtonLink tone="primary" href={inbox}><MessageSquare aria-hidden /> Conversations</ButtonLink> : null}
      {data.canCall ? <NewCallButton organizationId={organizationId} /> : null}
      {data.canCompose ? <ButtonLink tone="secondary" href={`${inbox}/new?channel=${data.composeChannel}`}><Mail aria-hidden /> New message</ButtonLink> : null}
      {configure}
    </>} />
    {mayCall && blocker ? <div role="status" data-state={blocker.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"><Phone aria-hidden className="size-4 shrink-0 text-muted" /><p className="min-w-0 flex-1">{blocker.reason}</p>{blocker.setup && setupHref ? <ButtonLink tone="text" href={setupHref}>Number assignments</ButtonLink> : null}</div> : null}
    <div className="grid grid-cols-2 gap-3 @min-[64rem]/comms:grid-cols-4">
      {mayCall ? <><MetricTile label="Missed calls" value={data.missed?.total ?? '—'} detail={period} href={`${calls}?state=missed&when=${params.when}#call-history`} /><MetricTile label="Needs wrap-up" value={data.counts?.needsWrapUp ?? '—'} detail="Outstanding" href={`${calls}?wrap=1#call-history`} /></> : null}
      {mayMessage ? <><MetricTile label="Unread conversations" value={data.inboxCounts?.unread ?? '—'} detail="Outstanding" href={`${inbox}?view=unread`} /><MetricTile label="Unassigned conversations" value={data.inboxCounts?.unassigned ?? '—'} detail="Outstanding" href={`${inbox}?view=unassigned`} /></> : null}
    </div>
    <div className="grid min-w-0 gap-3 @min-[64rem]/comms:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-3">
        <OperationalPanel density="compact" title="Needs attention" href={noAttention ? undefined : attentionHref} hrefLabel={attention === 'unread' || attention === 'unassigned' ? 'Open conversations' : 'Open call history'}>
          <ViewNav label="Attention categories" variant="line" scroll={false} className="mb-3" items={attentionTabs.map(tab => ({ key: tab.key, label: `${tab.label} (${tab.count})`, href: link({ attention: tab.key }), current: attention === tab.key }))} />
          {attention === 'unread' || attention === 'unassigned' ? <ConversationPreview organizationId={organizationId} timezone={timezone} items={(attention === 'unread' ? data.unread : data.unassigned)?.items ?? []} query={`?view=${attention}`} /> : !attentionCalls.length ? <CompactEmptyState>{attention === 'wrap' ? 'No calls need wrap-up.' : 'No missed calls in this period.'}</CompactEmptyState> : <div className="overflow-x-auto"><Table className="text-sm"><TableHeader><TableRow>{['Contact', 'Time', 'Status', 'Action'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{attentionCalls.map(call => <TableRow key={call.id}>
            <TableCell><Link href={`${calls}/${call.id}`} className="font-medium hover:underline">{call.customerName ?? (call.externalNumber ? formatPhoneForDisplay(call.externalNumber) : 'Withheld number')}</Link></TableCell>
            <TableCell className="whitespace-nowrap text-muted">{formatTime(call.startedAt, timezone)}</TableCell>
            <TableCell><Badge tone={attention === 'wrap' ? 'accent' : 'neutral'}>{attention === 'wrap' ? 'Needs outcome' : callStatusLabel(call)}</Badge></TableCell>
            <TableCell>{attention === 'wrap' ? <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={data.outcomes} /> : data.callingReady && call.externalNumber ? <NewCallButton compact organizationId={organizationId} toNumber={call.externalNumber} /> : <Link href={`${calls}/${call.id}`} className="text-accent-text">Open call</Link>}</TableCell>
          </TableRow>)}</TableBody></Table></div>}
        </OperationalPanel>
        {mayMessage ? <OperationalPanel density="compact" title="Conversations" count={data.queue?.total} href={`${inbox}${inboxSuffix}`} hrefLabel="Open conversations"><ConversationPreview items={data.queue?.items ?? []} organizationId={organizationId} timezone={timezone} query={inboxSuffix} /></OperationalPanel> : null}
        {mayCall ? <OperationalPanel density="compact" title="Recent calls" count={data.calls?.total} meta={period} href={`${calls}${callSuffix}#call-history`} hrefLabel="Open call history">{data.calls?.items.length ? <CallHistory organizationId={organizationId} timeZone={timezone} compact calls={data.calls.items.slice(0, 4)} renderWrapUp={call => call.status === 'completed' && !call.outcome ? <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={data.outcomes} /> : null} /> : <CompactEmptyState>No calls recorded in this period.</CompactEmptyState>}</OperationalPanel> : null}
      </div>
      <aside aria-label="Communications activity" className="min-w-0 space-y-3">
        <OperationalPanel density="compact" title="Recent activity">{data.activity.length ? <ul className="divide-y divide-border">{data.activity.map(item => <li key={item.id}><Link href={item.href} className="flex items-start gap-2 py-2 text-sm hover:underline"><span className="min-w-0 flex-1"><span className="block font-medium">{item.context}</span><span className="block text-xs text-muted">{item.title}</span><time className="block text-xs text-muted" dateTime={item.at}>{formatTime(item.at, timezone)}</time></span></Link></li>)}</ul> : <CompactEmptyState>No recent activity.</CompactEmptyState>}</OperationalPanel>
        {mayCall ? <OperationalPanel density="compact" title="Call performance" meta={period}><dl className="space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted">Recorded calls</dt><dd className="font-medium tabular-nums">{data.calls?.total ?? '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">Answer rate</dt><dd className="font-medium tabular-nums">{!params.search && data.calls?.total ? `${Math.round(data.answered / data.calls.total * 100)}%` : '—'}</dd></div></dl>{!data.calls?.total ? <p className="mt-3 text-xs text-muted">No calls recorded in this period.</p> : params.search ? <p className="mt-3 text-xs text-muted">Clear the search to see the answer rate.</p> : <p className="mt-3 text-xs text-muted">{data.answered} answered of {data.calls.total} recorded calls.</p>}</OperationalPanel> : null}
      </aside>
    </div>
  </AppPage>;
}
