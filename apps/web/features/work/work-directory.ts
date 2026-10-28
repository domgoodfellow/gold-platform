/**
 * The Work items directory's view, as the address states it: the one view model for the toolbar,
 * the List / Board choice, chips, Reset and pagination. A status belongs to one Work type and the
 * Board shows every status as a column, so changing the type or choosing the Board drops it, and
 * any change of criteria returns to the first page.
 */
export const WORK_PAGE_SIZE = 20;
export const WORK_SORTS = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title'], ['schedule', 'Schedule']] as const;
export type WorkSort = (typeof WORK_SORTS)[number][0];
export type WorkDirectoryView = { type?: string; view: 'list' | 'board'; q: string; status?: string; sort: WorkSort; page: number };

export function parseWorkDirectory(query: Record<string, string | string[] | undefined>): WorkDirectoryView {
  const text = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const sort = WORK_SORTS.find(([key]) => key === text('sort'))?.[0] ?? 'newest';
  return {
    type: text('type') || undefined,
    view: text('view') === 'board' ? 'board' : 'list',
    q: text('q').trim(),
    status: text('status') || undefined,
    sort,
    page: Math.max(1, Math.min(100000, Math.trunc(Number(text('page'))) || 1)),
  };
}

export function workDirectoryHref(organizationId: string, view: WorkDirectoryView, changes: Partial<WorkDirectoryView> = {}): string {
  const next = { ...view, ...changes };
  if (changes.type !== undefined && changes.type !== view.type) next.status = undefined;
  if (next.view === 'board') next.status = undefined;
  if (!('page' in changes)) next.page = 1;
  const params = new URLSearchParams();
  if (next.type) params.set('type', next.type);
  if (next.view === 'board') params.set('view', 'board');
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.sort !== 'newest') params.set('sort', next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return `/organizations/${organizationId}/work${text ? `?${text}` : ''}`;
}
