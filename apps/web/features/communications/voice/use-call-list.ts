'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { callListEntryAction, loadCallListAction } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import type { CallListPage, DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { CALL_LIST_PAGE_SIZE, CALL_LIST_READ_LIMIT, type CallListView } from '@/lib/domain/tasks/call-list-views';

export type CallListData = Pick<CallListPage, 'items' | 'counts' | 'total'>;
type Query = { view: CallListView; search: string; skipped: readonly string[] };

/** How long typing rests before the server is asked. */
const SEARCH_REST_MS = 250;

/**
 * The call list as the Dialer holds it: the server's rows for the operator's view and search,
 * paged, with every view's count.
 *
 * The route draws the first page of the default view (`initial`), so an ordinary visit asks
 * nothing more. Any other view, a search, skipped calls or a further page is read through the
 * server; nothing is filtered here. What was read is kept only for the question it answered and
 * the route's rows it was read beside, so a slow answer to an earlier question never replaces the
 * current one, and rows the route has since read again are never shown stale for the default view.
 *
 * `onSelected` reports the selected entry as each read finds it: the entry again, or null when it
 * is no longer on the list (completed, removed or cancelled by anyone).
 */
export function useCallList({ organizationId, initial, query, enabled, selectedId, onSelected }: {
  organizationId: string;
  /** The first page of the default view, as the route last drew it. A new object means the page was read again. */
  initial: CallListData;
  query: Query;
  /** False when the business has no call list at all: nothing is asked. */
  enabled: boolean;
  selectedId: string | null;
  onSelected: (entry: DialerQueueEntry | null) => void;
}) {
  const [read, setRead] = useState<{ basis: CallListData; key: string; data: CallListData } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const sequence = useRef(0);

  const plain = query.view === 'all' && !query.search.trim() && query.skipped.length === 0;
  const queryKey = JSON.stringify([query.view, query.search.trim(), query.skipped]);
  const current = read && read.basis === initial && read.key === queryKey ? read.data : null;
  // Between a question and its answer: the route's rows for the default view, otherwise the last rows read.
  const data = current ?? (plain ? initial : read?.data ?? initial);

  const latest = useRef({ query, queryKey, initial, data, selectedId, onSelected });
  useEffect(() => { latest.current = { query, queryKey, initial, data, selectedId, onSelected }; });

  /** Reads the list again from its start, keeping as many rows as are loaded (up to the read limit). */
  const reload = useCallback(async (rows?: number) => {
    const asked = latest.current;
    const turn = ++sequence.current;
    setLoading(true);
    const limit = Math.min(Math.max(rows ?? asked.data.items.length, CALL_LIST_PAGE_SIZE), CALL_LIST_READ_LIMIT);
    const result = await loadCallListAction(organizationId, { view: asked.query.view, search: asked.query.search, skipped: [...asked.query.skipped] }, { offset: 0, limit, selectedId: asked.selectedId }).catch(() => null);
    if (turn !== sequence.current) return;
    setLoading(false);
    if (!result || result.error) { setFailure({ key: asked.queryKey, message: result?.error ?? 'The call list could not be loaded.' }); return; }
    setFailure(null);
    setRead({ basis: asked.initial, key: asked.queryKey, data: { items: result.items, counts: result.counts, total: result.total } });
    if (asked.selectedId && result.selected !== undefined && latest.current.selectedId === asked.selectedId) asked.onSelected(result.selected);
  }, [organizationId]);

  const loadMore = useCallback(async () => {
    const asked = latest.current;
    const turn = sequence.current;
    setLoadingMore(true);
    const result = await loadCallListAction(organizationId, { view: asked.query.view, search: asked.query.search, skipped: [...asked.query.skipped] }, { offset: asked.data.items.length, limit: CALL_LIST_PAGE_SIZE }).catch(() => null);
    setLoadingMore(false);
    // A newer question was asked meanwhile; its answer owns the list.
    if (turn !== sequence.current || latest.current.queryKey !== asked.queryKey) return;
    if (!result || result.error) { setFailure({ key: asked.queryKey, message: result?.error ?? 'More calls could not be loaded.' }); return; }
    setFailure(null);
    const held = new Set(asked.data.items.map(entry => entry.task.id));
    setRead({ basis: latest.current.initial, key: asked.queryKey, data: { items: [...asked.data.items, ...result.items.filter(entry => !held.has(entry.task.id))], counts: result.counts, total: result.total } });
  }, [organizationId]);

  // The view, search or skipped calls changed: ask the server, after typing rests.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (!enabled) return undefined;
    if (firstQuery.current) {
      firstQuery.current = false;
      // A session restored with another view or search starts from the server; the default view is already drawn.
      if (plain) return undefined;
    }
    const timer = setTimeout(() => { void reload(CALL_LIST_PAGE_SIZE); }, SEARCH_REST_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plain` is derived from `queryKey`.
  }, [enabled, queryKey, reload]);

  // The route read the page again (after a call, an add, a removal). The default view shows the
  // route's rows as they are; another view, or more rows than the route drew, asks the server.
  const drawn = useRef(initial);
  useEffect(() => {
    if (drawn.current === initial) return;
    const before = drawn.current;
    drawn.current = initial;
    if (!enabled) return;
    const { selectedId: selected, onSelected: report, queryKey: key } = latest.current;
    const further = read && read.basis === before && read.key === key && read.data.items.length > initial.items.length && initial.items.length < initial.total;
    if (!plain || further) { void reload(read?.data.items.length); return; }
    if (!selected) return;
    const listed = initial.items.find(entry => entry.task.id === selected);
    if (listed) report(listed);
    // Every call is loaded and theirs is not among them: they are no longer on the list.
    else if (initial.items.length >= initial.total) report(null);
    else void callListEntryAction(organizationId, selected).then(result => { if (!result.error && latest.current.selectedId === selected) report(result.entry); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the route's rows change, reading the rest as it then stands.
  }, [initial]);

  return { ...data, loading, loadingMore, error: failure && failure.key === queryKey ? failure.message : null, reload, loadMore };
}
