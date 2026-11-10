import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { INBOX_PAGE_SIZE, type InboxCounts, type InboxFilter, type InboxItem, type InboxPage } from './inbox';

/** Common operating rows, preserving channel-specific records and unknown website read state. */
export async function listConversationFeed(db: Db, input: { organizationId: string; filter?: InboxFilter; membershipId?: string | null; cursor?: string | null; limit?: number }): Promise<InboxPage> {
  const filter = input.filter ?? {};
  const limit = Math.min(Math.max(input.limit ?? INBOX_PAGE_SIZE, 1), 100);
  let query = db.from('conversation_feed').select('*', { count: 'exact' }).eq('organization_id', input.organizationId);
  const search = filter.search?.replace(/[^\p{L}\p{N} @+._-]/gu, '').slice(0, 100).trim();
  if (search) query = query.or(`title.ilike.%${search}%,external_address.ilike.%${search}%,subject.ilike.%${search}%,preview.ilike.%${search}%`);
  if (filter.channel) query = query.eq('channel', filter.channel);
  if (filter.since) query = query.gte('last_activity_at', filter.since);
  if (filter.until) query = query.lt('last_activity_at', filter.until);
  if (filter.view === 'unread') query = query.eq('unread', true);
  if (filter.view === 'unassigned') query = query.is('assignee_membership_id', null);
  if (filter.view === 'mine') query = query.eq('assignee_membership_id', input.membershipId ?? '00000000-0000-0000-0000-000000000000');
  const status = filter.status ?? 'active';
  if (status === 'active') query = query.neq('status', 'closed');
  else if (status !== 'any') query = query.eq('status', status);
  if (input.cursor) {
    const [at, source, id] = input.cursor.split('|');
    if (!at || !/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(at) || !['message', 'website'].includes(source) || !/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError('That page of conversations is not valid.', 'inbox.cursor_invalid');
    query = query.or(`last_activity_at.lt."${at}",and(last_activity_at.eq."${at}",source.lt.${source}),and(last_activity_at.eq."${at}",source.eq.${source},id.lt.${id})`);
  }
  const { data, error, count } = await query.order('last_activity_at', { ascending: false }).order('source', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) throw fromDatabaseError(error, 'inbox.list_failed');
  const rows = data ?? [];
  const items: InboxItem[] = rows.slice(0, limit).map(row => ({
    id: row.id!, source: row.source === 'website' ? 'website' : 'message', channel: row.channel as InboxItem['channel'], title: row.title ?? '',
    externalAddress: row.external_address ?? '', subject: row.subject, preview: row.preview ?? '', lastActivityAt: row.last_activity_at!,
    unread: row.unread, status: row.status as InboxItem['status'], sourceStatus: row.source_status ?? undefined,
    assignee: row.assignee_membership_id ? { membershipId: row.assignee_membership_id, name: row.assignee_name ?? 'Member' } : null,
    customer: row.customer_id ? { id: row.customer_id, name: row.customer_name ?? 'Contact' } : null,
  }));
  const last = items.at(-1);
  return { items, total: count ?? undefined, nextCursor: rows.length > limit && last ? `${last.lastActivityAt}|${last.source}|${last.id}` : null };
}

export async function conversationFeedCounts(db: Db, input: { organizationId: string; membershipId?: string | null }): Promise<InboxCounts> {
  const base = () => db.from('conversation_feed').select('id', { count: 'exact', head: true }).eq('organization_id', input.organizationId);
  const [unread, open, waiting, unassigned, mine] = await Promise.all([
    base().eq('unread', true).neq('status', 'closed'), base().eq('status', 'open'), base().eq('status', 'waiting'),
    base().is('assignee_membership_id', null).neq('status', 'closed'),
    input.membershipId ? base().eq('assignee_membership_id', input.membershipId).neq('status', 'closed') : Promise.resolve({ error: null, count: 0 }),
  ]);
  for (const result of [unread, open, waiting, unassigned, mine]) if (result.error) throw fromDatabaseError(result.error, 'inbox.counts_failed');
  return { unread: unread.count ?? 0, open: open.count ?? 0, waiting: waiting.count ?? 0, unassigned: unassigned.count ?? 0, mine: mine.count ?? 0 };
}
