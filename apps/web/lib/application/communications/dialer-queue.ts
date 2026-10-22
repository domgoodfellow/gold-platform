import type { Db } from '@/lib/db/types';
import { getContact, type Contact } from '@/lib/domain/contacts/contacts';
import { listTasks, type CrmTask } from '@/lib/domain/tasks/tasks';
import { listCallPage, type Call } from '@/lib/domain/reception/calls';

/** How many of a queued customer's most recent recorded calls the Dialer shows beside them. */
export const RECENT_CALLS_PER_CUSTOMER = 3;

export type DialerQueueEntry = { followUp: CrmTask; customer: Contact | null; recentCalls: Call[] };

/**
 * The first page of open call follow-ups, earliest due first, with each customer read once and
 * their few most recent recorded calls. Bounded by the page: at most 25 customers, each read in
 * the same organization under the caller's own access.
 */
export async function loadDialerQueue(db: Db, organizationId: string): Promise<{ items: DialerQueueEntry[]; total: number }> {
  const followUps = await listTasks(db, { organizationId, status: 'open', kind: 'call', limit: 25 });
  const ids = [...new Set(followUps.map(item => item.customerId))];
  const context = new Map(await Promise.all(ids.map(async customerId => {
    const [customer, calls] = await Promise.all([
      getContact(db, { organizationId, customerId }),
      listCallPage(db, { organizationId, filter: { customerId }, limit: RECENT_CALLS_PER_CUSTOMER }),
    ]);
    return [customerId, { customer, recentCalls: calls.items }] as const;
  })));
  return {
    items: followUps.map(followUp => ({ followUp, customer: context.get(followUp.customerId)?.customer ?? null, recentCalls: context.get(followUp.customerId)?.recentCalls ?? [] })),
    total: followUps.total,
  };
}
