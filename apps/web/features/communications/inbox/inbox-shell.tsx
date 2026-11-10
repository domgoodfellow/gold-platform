'use client';

import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Mail, MessageSquare, Plus, Search, User } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { PeriodSelect } from '@/components/controls/period-select';
import { ViewNav } from '@/components/navigation/view-nav';
import { CompactEmptyState } from '@/components/operational/primitives';
import { inboxCountsAction, listInboxAction } from '@/app/organizations/[organizationId]/comms/inbox/actions';
import type { ConversationStatus, InboxCounts, InboxFilter, InboxItem } from '@/lib/domain/reception/inbox';
import { CONVERSATION_STATUS_LABEL, INBOX_CHANGED, relativeTime } from './format';

type Channel = 'all' | 'sms' | 'email';
type View = 'everything' | 'unread' | 'mine' | 'unassigned';
type Status = 'active' | ConversationStatus | 'any';

const CHANNELS: { key: Channel; label: string }[] = [{ key: 'all', label: 'SMS & email' }, { key: 'sms', label: 'SMS' }, { key: 'email', label: 'Email' }];
const VIEWS: { key: View; label: string; count?: keyof InboxCounts }[] = [
  { key: 'everything', label: 'All' },
  { key: 'mine', label: 'Mine', count: 'mine' },
  { key: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { key: 'unread', label: 'Unread', count: 'unread' },
];
const STATUSES: { key: Status; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'closed', label: 'Closed' },
  { key: 'any', label: 'All statuses' },
];

function emptyMessage(filter: InboxFilter): string {
  if (filter.search) return 'No conversations match this search.';
  if (filter.view === 'unread') return 'Nothing unread.';
  if (filter.view === 'mine') return 'Nothing is assigned to you.';
  if (filter.view === 'unassigned') return 'Every conversation has someone handling it.';
  if (filter.channel === 'sms') return 'No text conversations match.';
  if (filter.channel === 'email') return 'No email conversations match.';
  if (filter.status === 'closed') return 'No closed conversations.';
  if (filter.status === 'open' || filter.status === 'waiting') return `No ${CONVERSATION_STATUS_LABEL[filter.status].toLowerCase()} conversations.`;
  return 'No conversations yet.';
}

/**
 * The Inbox: one list over every asynchronous conversation, and the pane its selected conversation
 * opens in. On a wide screen the two sit side by side; on a narrow one it is one thing at a time — the
 * list, or the conversation with a way back — never two cramped panes.
 *
 * The filters live in the address, so a filtered view can be linked to and survives a reload, and the
 * list is read through the domain query (a page at a time, filtered in the database), never fetched
 * whole and narrowed here. It refreshes on its own every half minute, and straight away when a
 * conversation screen announces a change.
 */
export function InboxShell({ organizationId, children }: { organizationId: string; children: ReactNode }) {
  const base = `/organizations/${organizationId}/comms/inbox`;
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  const channel = CHANNELS.find(option => option.key === params.get('channel'))?.key ?? 'all';
  const view = VIEWS.find(option => option.key === params.get('view'))?.key ?? 'everything';
  const status = STATUSES.find(option => option.key === params.get('status'))?.key ?? 'active';
  const search = params.get('q')?.slice(0, 100) ?? '';
  const selectedId = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/')[0] : null;
  const detailOpen = selectedId !== null;

  const filter = useMemo<InboxFilter>(
    () => ({ channel: channel === 'all' ? undefined : channel, view: view === 'everything' ? undefined : view, status, search }),
    [channel, view, status, search],
  );

  const [items, setItems] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  // The key of the filter the list on screen was read for: a list read for another filter is not loaded yet.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const filterKey = `${channel}|${view}|${status}|${search}`;
  const loaded = loadedFor === filterKey;
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  type Read = [Awaited<ReturnType<typeof listInboxAction>>, Awaited<ReturnType<typeof inboxCountsAction>>];

  const apply = useCallback(
    ([page, tally]: Read) => {
      if (page.ok) {
        setItems(page.data.items);
        setCursor(page.data.nextCursor);
        setError(null);
      } else {
        setError(page.error);
      }
      setCounts(tally.ok ? tally.data : null);
      setLoadedFor(filterKey);
    },
    [filterKey],
  );

  // Each read supersedes the one before it, so a slow answer for an earlier filter can never overwrite a later one.
  const read = useCallback(() => {
    const mine = ++generation.current;
    return Promise.all([listInboxAction(organizationId, filter, null), inboxCountsAction(organizationId)]).then((result) => {
      if (mine === generation.current) apply(result);
    }).catch(() => {
      if (mine !== generation.current) return;
      setError('Conversations could not be loaded. Try again.');
      setLoadedFor(filterKey);
    });
  }, [organizationId, filter, filterKey, apply]);

  const invalidate = useCallback(() => { generation.current++; }, []);

  useEffect(() => {
    void read();
    const again = () => void read();
    window.addEventListener(INBOX_CHANGED, again);
    const timer = window.setInterval(again, 30_000);
    return () => {
      window.removeEventListener(INBOX_CHANGED, again);
      window.clearInterval(timer);
      invalidate();
    };
  }, [read, invalidate]);

  const loadMore = async () => {
    if (!cursor) return;
    const mine = generation.current;
    const page = await listInboxAction(organizationId, filter, cursor);
    if (mine !== generation.current) return;
    if (!page.ok) return setError(page.error);
    // A row that moved while the list was open can appear on a later page; it is shown once.
    setItems((previous) => [...previous, ...page.data.items.filter((item) => !previous.some((existing) => existing.id === item.id))]);
    setCursor(page.data.nextCursor);
  };

  const hrefWith = (next: { channel?: Channel; view?: View; status?: Status; search?: string }) => {
    const q = new URLSearchParams();
    const c = next.channel ?? channel;
    const v = next.view ?? view;
    const s = next.status ?? status;
    if (c !== 'all') q.set('channel', c);
    if (v !== 'everything') q.set('view', v);
    if (s !== 'active') q.set('status', s);
    const textSearch = (next.search ?? search).trim().slice(0, 100);
    if (textSearch) q.set('q', textSearch);
    const text = q.toString();
    return text ? `${base}?${text}` : base;
  };
  const withQuery = (path: string) => {
    const text = params.toString();
    return text ? `${path}?${text}` : path;
  };

  return (
    <div className="@container/conversations overflow-hidden rounded-lg border border-border bg-surface">
      {pathname.endsWith('/website') ? <div className="flex min-w-0 flex-col"><Link href={withQuery(base)} className="border-b border-border p-3 text-sm text-accent-text">← SMS & email conversations</Link>{children}</div> : <>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <ViewNav label="Conversation views" current={view} scroll={false} className="mb-0 max-w-full flex-nowrap! overflow-x-auto" views={VIEWS.map(option => ({ key: option.key, label: <>{option.label}{option.count && counts && counts[option.count] > 0 ? ` (${counts[option.count]})` : ''}</>, href: hrefWith({ view: option.key }) }))} />
        <PeriodSelect label="Messaging channel" value={channel} size="default" options={CHANNELS.map(option => ({ value: option.key, label: option.label, href: hrefWith({ channel: option.key }) }))} />
        <PeriodSelect label="Conversation status" value={status} size="default" options={STATUSES.map(option => ({ value: option.key, label: option.label, href: hrefWith({ status: option.key }) }))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ButtonLink tone="secondary" href={withQuery(`${base}/website`)}>Website chat</ButtonLink>
          <ButtonLink href={withQuery(`${base}/new`)} scroll={false}><Plus aria-hidden /> New message</ButtonLink>
        </div>
      </div>
      <div className={`flex ${detailOpen || loaded && !error && items.length ? 'h-[calc(100dvh-15rem)] min-h-96' : 'min-h-24'}`}>
      <section aria-label="Conversation list" className={`${detailOpen ? 'hidden @min-[48rem]/conversations:flex' : 'flex'} min-w-0 flex-col ${detailOpen || loaded && !error && items.length ? 'w-full @min-[48rem]/conversations:w-96 @min-[48rem]/conversations:shrink-0 @min-[48rem]/conversations:border-r @min-[48rem]/conversations:border-border' : 'w-full'}`}>
        <form role="search" className="flex items-center gap-2 border-b border-border p-3" onSubmit={event => { event.preventDefault(); router.push(hrefWith({ search: String(new FormData(event.currentTarget).get('q') ?? '') }), { scroll: false }); }}>
          {channel !== 'all' ? <input type="hidden" name="channel" value={channel} /> : null}
          {view !== 'everything' ? <input type="hidden" name="view" value={view} /> : null}
          {status !== 'active' ? <input type="hidden" name="status" value={status} /> : null}
          <TextInput key={search} type="search" name="q" aria-label="Search conversations" placeholder="Search conversations" defaultValue={search} maxLength={100} />
          <Button type="submit" tone="secondary" aria-label="Search conversations"><Search aria-hidden /></Button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={!loaded}>
          {loaded && error ? <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm"><p className="min-w-0 flex-1 text-danger">{error}</p><Button tone="secondary" onClick={() => void read()}>Try again</Button></div> : null}
          {!loaded ? <div role="status" aria-label="Loading conversations" className="space-y-4 p-4"><span className="sr-only">Loading conversations…</span>{[0, 1, 2].map(row => <div key={row} aria-hidden className="space-y-2"><div className="h-4 w-1/2 rounded bg-hover" /><div className="h-3 w-3/4 rounded bg-hover" /></div>)}</div> : null}
          {loaded && items.length === 0 && !error ? (
            <CompactEmptyState action={search || channel !== 'all' || view !== 'everything' || status !== 'active' ? <ButtonLink tone="text" href={base}>Clear filters</ButtonLink> : undefined}>{emptyMessage(filter)}</CompactEmptyState>
          ) : null}
          <ul>
            {loaded && !error ? items.map((item) => {
              const selected = item.id === selectedId;
              const ChannelIcon = item.channel === 'email' ? Mail : MessageSquare;
              return (
                <li key={item.id}>
                  <Link
                    href={withQuery(`${base}/${item.id}`)}
                    scroll={false}
                    aria-current={selected ? 'true' : undefined}
                    className={`block border-b border-border px-3 py-2 hover:bg-hover ${selected ? 'bg-hover' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChannelIcon className="h-3.5 w-3.5 shrink-0 text-muted" aria-label={item.channel === 'email' ? 'Email' : 'SMS'} role="img" />
                        <span className={`truncate ${item.unread ? 'font-semibold' : 'font-medium'}`}>{item.channel === 'sms' ? formatPhoneForDisplay(item.title) : item.title}</span>
                        {item.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" role="img" aria-label="Unread" /> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{relativeTime(item.lastActivityAt)}</span>
                    </div>
                    {item.customer ? <div className="truncate text-xs text-muted">{item.channel === 'sms' ? formatPhoneForDisplay(item.externalAddress) : item.externalAddress}</div> : null}
                    {item.subject ? <div className={`truncate text-sm ${item.unread ? 'font-medium' : ''}`}>{item.subject}</div> : null}
                    <div className="truncate text-sm text-muted">{item.preview || '—'}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <span>{CONVERSATION_STATUS_LABEL[item.status]}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" aria-hidden />{item.assignee ? item.assignee.name : 'Unassigned'}</span>
                    </div>
                  </Link>
                </li>
              );
            }) : null}
          </ul>
          {loaded && !error && cursor ? (
            <div className="p-2">
              <Button type="button" size="small" tone="secondary" className="w-full" onClick={loadMore}>Load more</Button>
            </div>
          ) : null}
        </div>
      </section>

      {detailOpen || loaded && !error && items.length > 0 ? <section aria-label="Conversation" className={`${detailOpen ? 'flex' : 'hidden @min-[48rem]/conversations:flex'} min-w-0 flex-1 flex-col`}>
        {children}
      </section> : null}
      </div>
      </>}
    </div>
  );
}
