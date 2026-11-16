import type { Db } from '@/lib/db/types';
import { callListCounts, isCallListView, listCallListEntries, taskIds, type CallListCounts, type CallListEntry, type CallListView } from '@/lib/domain/tasks/call-list';
import { CALL_LIST_PAGE_SIZE, CALL_LIST_READ_LIMIT, CALL_LIST_SEARCH_MAX } from '@/lib/domain/tasks/call-list-views';

export type DialerQueueEntry = CallListEntry;
/** What the operator is looking at: a view, a search, and the calls skipped for this calling session. */
export type CallListQuery = { view: CallListView; search: string; skipped: readonly string[] };
export type CallListPage = {
  items: CallListEntry[];
  counts: CallListCounts;
  /** How many calls the chosen view holds: the count that view shows, never a second sum. */
  total: number;
  /** The selected task read again, wherever it sits; null when it is no longer on the list. */
  selected?: CallListEntry | null;
};

export const DEFAULT_CALL_LIST_QUERY: CallListQuery = { view: 'all', search: '', skipped: [] };

/** A query as the server will run it, whatever a browser sent. */
export function callListQuery(input: Partial<CallListQuery> | null | undefined): CallListQuery {
  return {
    view: isCallListView(input?.view) ? input.view : 'all',
    search: typeof input?.search === 'string' ? input.search.trim().slice(0, CALL_LIST_SEARCH_MAX) : '',
    skipped: taskIds(Array.isArray(input?.skipped) ? input.skipped : []),
  };
}

/**
 * The Dialer's call list: one page of a view with every view's count for the same search, read
 * through the Dialer's own disclosure (`call_list_page`), so placing calls shows who is on the
 * list without opening the contact directory. Skipped calls are left out of rows and counts alike.
 */
export async function loadCallList(db: Db, organizationId: string, query: CallListQuery = DEFAULT_CALL_LIST_QUERY, page: { offset?: number; limit?: number; selectedId?: string | null } = {}): Promise<CallListPage> {
  const filter = { organizationId, search: query.search, exclude: query.skipped };
  const limit = Math.max(1, Math.min(page.limit ?? CALL_LIST_PAGE_SIZE, CALL_LIST_READ_LIMIT));
  const [items, counts, selected] = await Promise.all([
    listCallListEntries(db, { ...filter, view: query.view, limit, offset: Math.max(0, page.offset ?? 0) }),
    callListCounts(db, filter),
    page.selectedId ? listCallListEntries(db, { organizationId, taskIds: [page.selectedId], limit: 1 }) : null,
  ]);
  return { items, counts, total: counts[query.view], ...(selected ? { selected: selected[0] ?? null } : {}) };
}

/**
 * Who is next in a calling session: the earliest-due call in the operator's view and search that
 * has a phone number and has been neither skipped nor already called this session. Read at the
 * moment of asking, so a call someone else completed, removed or rescheduled out of the view is
 * never offered. Null when nobody is left.
 */
export async function nextCallListEntry(db: Db, organizationId: string, query: CallListQuery, passed: readonly string[]): Promise<CallListEntry | null> {
  const [next] = await listCallListEntries(db, {
    organizationId, view: query.view, search: query.search, exclude: [...query.skipped, ...passed], limit: 1, callableOnly: true,
  });
  return next ?? null;
}
