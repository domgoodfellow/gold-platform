import type { Db } from '@/lib/db/types';
import { getCustomer, type Customer } from '@/lib/domain/customers/customers';
import { listFollowUps, type FollowUp } from '@/lib/domain/follow-ups/follow-ups';

export type DialerQueueEntry = { followUp: FollowUp; customer: Customer | null };

export async function loadDialerQueue(db: Db, organizationId: string): Promise<{ items: DialerQueueEntry[]; total: number }> {
  const followUps = await listFollowUps(db, { organizationId, status: 'open', kind: 'call', limit: 25 });
  const ids = [...new Set(followUps.map(item => item.customerId))];
  const customers = new Map(await Promise.all(ids.map(async customerId => [customerId, await getCustomer(db, { organizationId, customerId })] as const)));
  return { items: followUps.map(followUp => ({ followUp, customer: customers.get(followUp.customerId) ?? null })), total: followUps.total };
}
