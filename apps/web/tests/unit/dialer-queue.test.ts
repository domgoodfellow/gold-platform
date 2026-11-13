import { expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { loadDialerQueue } from '@/lib/application/communications/dialer-queue';
import { listTasks } from '@/lib/domain/tasks/tasks';
import { callListContacts, listCallPage } from '@/lib/domain/reception/calls';
import { counted } from '@/lib/domain/counted';
vi.mock('@/lib/domain/tasks/tasks', () => ({ listTasks: vi.fn() }));
vi.mock('@/lib/domain/reception/calls', () => ({ listCallPage: vi.fn(), callListContacts: vi.fn() }));
it('loads real open Call tasks and each listed contact once, through the call list disclosure', async () => {
  vi.mocked(listTasks).mockResolvedValue(counted([{ id: 'first', customerId: 'customer' }, { id: 'second', customerId: 'customer' }] as never, 45));
  vi.mocked(callListContacts).mockResolvedValue([{ id: 'customer', name: 'Customer', email: null, phone: '+14165550100' }]);
  vi.mocked(listCallPage).mockResolvedValue({ items: [{ id: 'call' }], nextCursor: null } as never);
  const db = {} as Db;
  const queue = await loadDialerQueue(db, 'tenant');
  expect(listTasks).toHaveBeenCalledWith(db, { organizationId: 'tenant', kind: 'call', status: 'open', limit: 25 });
  // Not the contact directory: only the contacts on the list, with what calling them needs.
  expect(callListContacts).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', customerIds: ['customer'] });
  expect(listCallPage).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', filter: { customerId: 'customer' }, limit: 3 });
  expect(queue.total).toBe(45); expect(queue.items.map(item => item.task.id)).toEqual(['first', 'second']);
  expect(queue.items[0].customer?.name).toBe('Customer');
  expect(queue.items[1].recentCalls.map(call => call.id)).toEqual(['call']);
});

it('leaves an entry without a contact when the disclosure returns none for it', async () => {
  vi.mocked(listTasks).mockResolvedValue(counted([{ id: 'only', customerId: 'gone' }] as never, 1));
  vi.mocked(callListContacts).mockResolvedValue([]);
  vi.mocked(listCallPage).mockResolvedValue({ items: [], nextCursor: null } as never);
  const queue = await loadDialerQueue({} as Db, 'tenant');
  expect(queue.items[0].customer).toBeNull();
});
