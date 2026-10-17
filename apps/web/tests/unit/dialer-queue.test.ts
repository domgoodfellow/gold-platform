import { expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { loadDialerQueue } from '@/lib/application/communications/dialer-queue';
import { listFollowUps } from '@/lib/domain/follow-ups/follow-ups';
import { getCustomer } from '@/lib/domain/customers/customers';
import { counted } from '@/lib/domain/counted';
vi.mock('@/lib/domain/follow-ups/follow-ups', () => ({ listFollowUps: vi.fn() }));
vi.mock('@/lib/domain/customers/customers', () => ({ getCustomer: vi.fn() }));
it('loads real open call follow-ups and deduplicated customer context in the same organization', async () => {
  vi.mocked(listFollowUps).mockResolvedValue(counted([{ id: 'first', customerId: 'customer' }, { id: 'second', customerId: 'customer' }] as never, 45));
  vi.mocked(getCustomer).mockResolvedValue({ id: 'customer', name: 'Customer' } as never);
  const db = {} as Db;
  const queue = await loadDialerQueue(db, 'tenant');
  expect(listFollowUps).toHaveBeenCalledWith(db, { organizationId: 'tenant', kind: 'call', status: 'open', limit: 25 });
  expect(getCustomer).toHaveBeenCalledExactlyOnceWith(db, { organizationId: 'tenant', customerId: 'customer' });
  expect(queue.total).toBe(45); expect(queue.items.map(item => item.followUp.id)).toEqual(['first', 'second']);
  expect(queue.items[0].customer?.name).toBe('Customer');
});
