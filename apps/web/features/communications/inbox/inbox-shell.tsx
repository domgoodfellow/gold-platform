'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Mail, MessageSquare, Plus, User } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { EmptyState } from '@/components/surfaces/section';
import { inboxCountsAction, listInboxAction } from '@/app/organizations/[organizationId]/comms/inbox/actions';
import type { ConversationStatus, InboxCounts, InboxFilter, InboxItem } from '@/lib/domain/reception/inbox';
import { CONVERSATION_STATUS_LABEL, INBOX_CHANGED, relativeTime } from './format';

type Channel = 'all' | 'sms' | 'email';
type View = 'everything' | 'unread' | 'mine' | 'unassigned';
type Status = 'active' | ConversationStatus | 'any';

const CHANNELS: { key: Channel; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'sms', label: 'SMS' }, { key: 'email', label: 'Email' }];
const VIEWS: { key: View; label: string; count?: keyof InboxCounts }[] = [
  { key: 'everything', label: 'Everything' },
  { key: 'unread', label: 'Unread', count: 'unread' },
  { key: 'mine', label: 'Assigned to me', count: 'mine' },
  { key: 'unassigned', label: 'Unassigned', count: 'unassigned' },
];
const STATUSES: { key: Status; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'closed', label: 'Closed' },
  { key: 'any', label: 'Any' },
];

function Chip({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${active ? 'border-accent bg-accent text-on-accent' : 'border-border hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function emptyMessage(filter: InboxFilter): string {
  if (filter.view === 'unread') return 'Nothing unread.';
  if (filter.view === 'mine') return 'Nothing is assigned to you.';
  if (filter.view === 'unassigned') return 'Every conversation has someone handling it.';
  if (filter.channel === 'sms') return 'No text conversations match.';
  if (filter.channel === 'email') return 'No email conversations match.';
  if (filter.status === 'closed') return 'No closed conversations.';
  if (filter.status === 'open' || filter.status === 'waiting') return `No ${filter.status} conversations.`;
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
  const params = useSearchParams();

  const channel = (params.get('channel') as Channel | null) ?? 'all';
  const view = (params.get('view') as View | null) ?? 'everything';
  const status = (params.get('status') as Status | null) ?? 'active';
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
      if (tally.ok) setCounts(tally.data);
      setLoadedFor(filterKey);
    },
    [filterKey],
  );

  // Each read supersedes the one before it, so a slow answer for an earlier filter can never overwrite a later one.
  const read = useCallback(() => {
    const mine = ++generation.current;
    return Promise.all([listInboxAction(organizationId, filter, null), inboxCountsAction(organizationId)]).then((result) => {
      if (mine === generation.current) apply(result);
    });
  }, [organizationId, filter, apply]);

  useEffect(() => {
    void read();
    const again = () => void read();
    window.addEventListener(INBOX_CHANGED, again);
    const timer = window.setInterval(again, 30_000);
    return () => {
      window.removeEventListener(INBOX_CHANGED, again);
      window.clearInterval(timer);
    };
  }, [read]);

  const loadMore = async () => {
    if (!cursor) return;
    const page = await listInboxAction(organizationId, filter, cursor);
    if (!page.ok) return setError(page.error);
    // A row that moved while the list was open can appear on a later page; it is shown once.
    setItems((previous) => [...previous, ...page.data.items.filter((item) => !previous.some((existing) => existing.id === item.id))]);
    setCursor(page.data.nextCursor);
  };

  const hrefWith = (next: { channel?: Channel; view?: View; status?: Status }) => {
    const q = new URLSearchParams();
    const c = next.channel ?? channel;
    const v = next.view ?? view;
    const s = next.status ?? status;
    if (c !== 'all') q.set('channel', c);
    if (v !== 'everything') q.set('view', v);
    if (s !== 'active') q.set('status', s);
    const text = q.toString();
    return text ? `${base}?${text}` : base;
  };
  const withQuery = (path: string) => {
    const text = params.toString();
    return text ? `${path}?${text}` : path;
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[24rem] overflow-hidden rounded-lg border border-border md:h-[78vh]">
      <section aria-label="Conversations" className={`${detailOpen ? 'hidden md:flex' : 'flex'} w-full min-w-0 flex-col border-r border-border md:w-96 md:shrink-0`}>
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Channel">
              {CHANNELS.map((option) => (
                <Chip key={option.key} active={channel === option.key} href={hrefWith({ channel: option.key })}>{option.label}</Chip>
              ))}
            </div>
            <ButtonLink href={withQuery(`${base}/new`)} scroll={false} size="small">
              <Plus aria-hidden /> New
            </ButtonLink>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
            {VIEWS.map((option) => (
              <Chip key={option.key} active={view === option.key} href={hrefWith({ view: option.key })}>
                {option.label}{option.count && counts && counts[option.count] > 0 ? ` · ${counts[option.count]}` : ''}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
            {STATUSES.map((option) => (
              <Chip key={option.key} active={status === option.key} href={hrefWith({ status: option.key })}>{option.label}</Chip>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="p-4 text-sm text-danger">{error}</p> : null}
          {!loaded ? <p className="p-4 text-sm text-muted">Loading…</p> : null}
          {loaded && items.length === 0 && !error ? (
            <div className="p-6"><EmptyState>{emptyMessage(filter)}</EmptyState></div>
          ) : null}
          <ul>
            {items.map((item) => {
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
                        <span className={`truncate ${item.unread ? 'font-semibold' : 'font-medium'}`}>{item.title}</span>
                        {item.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" role="img" aria-label="Unread" /> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{relativeTime(item.lastActivityAt)}</span>
                    </div>
                    {item.customer ? <div className="truncate text-xs text-muted">{item.externalAddress}</div> : null}
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
            })}
          </ul>
          {cursor ? (
            <div className="p-2">
              <Button type="button" size="small" tone="secondary" className="w-full" onClick={loadMore}>Load more</Button>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-label="Conversation" className={`${detailOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {children}
      </section>
    </div>
  );
}
