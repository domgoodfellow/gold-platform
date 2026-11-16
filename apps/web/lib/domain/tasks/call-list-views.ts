/**
 * The call list's views and sizes: plain values with no database behind them, so the browser and
 * the server name the same views.
 *
 * - `all`: every open Call task.
 * - `mine`: owned by the asking member.
 * - `due`: due at or before now. Includes overdue calls: everything that can be called now.
 * - `overdue`: due before today began in the business's timezone.
 * - `upcoming`: due later than now.
 * - `callbacks`: scheduled as a callback after a call; never read from a task's wording.
 */
export const CALL_LIST_VIEWS = ['all', 'mine', 'due', 'overdue', 'upcoming', 'callbacks'] as const;
export type CallListView = (typeof CALL_LIST_VIEWS)[number];
export type CallListCounts = Record<CallListView, number>;

export function isCallListView(value: unknown): value is CallListView {
  return (CALL_LIST_VIEWS as readonly unknown[]).includes(value);
}

/** How many calls the Dialer loads at a time. */
export const CALL_LIST_PAGE_SIZE = 25;
/** The most calls one read returns, however far the list has been paged. */
export const CALL_LIST_READ_LIMIT = 100;
/** The longest search the call list accepts. */
export const CALL_LIST_SEARCH_MAX = 120;
