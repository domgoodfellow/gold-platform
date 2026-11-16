import { afterEach, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { callListQuery, loadCallList, nextCallListEntry } from '@/lib/application/communications/dialer-queue';
import { callListCounts, listCallListEntries } from '@/lib/domain/tasks/call-list';

vi.mock('@/lib/domain/tasks/call-list', async (original) => ({
  ...(await original<typeof import('@/lib/domain/tasks/call-list')>()),
  listCallListEntries: vi.fn(),
  callListCounts: vi.fn(),
}));

const db = {} as Db;
const counts = { all: 45, mine: 4, due: 12, overdue: 3, upcoming: 33, callbacks: 2 };
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.clearAllMocks());

it('reads one page of the view and every view’s count through the call list disclosure, for the same search and skipped calls', async () => {
  vi.mocked(listCallListEntries).mockResolvedValue([{ task: { id: 'a' } }, { task: { id: 'b' } }] as never);
  vi.mocked(callListCounts).mockResolvedValue(counts);
  const page = await loadCallList(db, 'tenant', { view: 'overdue', search: 'acme', skipped: [first] }, { offset: 25 });
  expect(listCallListEntries).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', search: 'acme', exclude: [first], view: 'overdue', limit: 25, offset: 25 });
  expect(callListCounts).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', search: 'acme', exclude: [first] });
  // The total is the chosen view's own count, never a second sum.
  expect(page).toEqual({ items: [{ task: { id: 'a' } }, { task: { id: 'b' } }], counts, total: 3 });
});

it('defaults to the first page of every call, and bounds how many rows one read returns', async () => {
  vi.mocked(listCallListEntries).mockResolvedValue([]);
  vi.mocked(callListCounts).mockResolvedValue(counts);
  expect((await loadCallList(db, 'tenant')).total).toBe(45);
  expect(listCallListEntries).toHaveBeenLastCalledWith(db, expect.objectContaining({ view: 'all', limit: 25, offset: 0, exclude: [] }));
  await loadCallList(db, 'tenant', undefined, { limit: 5000, offset: -3 });
  expect(listCallListEntries).toHaveBeenLastCalledWith(db, expect.objectContaining({ limit: 100, offset: 0 }));
});

it('reads the selected task again wherever it sits, and reports one that has left the list as null', async () => {
  vi.mocked(callListCounts).mockResolvedValue(counts);
  vi.mocked(listCallListEntries).mockImplementation(async (_db, input) => (input.taskIds ? [] : [{ task: { id: 'a' } }]) as never);
  const page = await loadCallList(db, 'tenant', { view: 'mine', search: '', skipped: [] }, { selectedId: first });
  // Not narrowed by the view or the search: a selection made in another view is still found.
  expect(listCallListEntries).toHaveBeenCalledWith(db, { organizationId: 'tenant', taskIds: [first], limit: 1 });
  expect(page.selected).toBeNull();
  expect('selected' in await loadCallList(db, 'tenant')).toBe(false);
});

it('chooses the next call from the same view and search, leaving out skipped and already called tasks and anyone with no number', async () => {
  vi.mocked(listCallListEntries).mockResolvedValue([{ task: { id: 'next' } }] as never);
  expect(await nextCallListEntry(db, 'tenant', { view: 'due', search: 'north', skipped: [first] }, [second])).toEqual({ task: { id: 'next' } });
  expect(listCallListEntries).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', view: 'due', search: 'north', exclude: [first, second], limit: 1, callableOnly: true });
  vi.mocked(listCallListEntries).mockResolvedValue([]);
  expect(await nextCallListEntry(db, 'tenant', { view: 'due', search: '', skipped: [] }, [])).toBeNull();
});

it('runs a browser’s query only as a known view, a bounded search and well-formed task ids', () => {
  expect(callListQuery(null)).toEqual({ view: 'all', search: '', skipped: [] });
  expect(callListQuery({ view: 'everything' as never, search: `  ${'x'.repeat(300)}  `, skipped: [first, 'not-an-id', first, 7 as never] }))
    .toEqual({ view: 'all', search: 'x'.repeat(120), skipped: [first] });
  expect(callListQuery({ view: 'callbacks', search: 'Acme', skipped: 'nope' as never })).toEqual({ view: 'callbacks', search: 'Acme', skipped: [] });
});
