import type { Db } from '@/lib/db/types';
import { getContact, type Contact } from '@/lib/domain/contacts/contacts';
import { listTasks, type CrmTask } from '@/lib/domain/tasks/tasks';
import { listCallPage, type Call } from '@/lib/domain/reception/calls';

/** How many of a queued customer's most recent recorded calls the Dialer shows beside them. */
export const RECENT_CALLS_PER_CUSTOMER = 3;

export type DialerQueueEntry = { task: CrmTask; customer: Contact | null; recentCalls: Call[] };

/**
 * The Dialer's call list: the first page of open Call tasks, earliest due first, with each customer read once and
 * their few most recent recorded calls. Bounded by the page: at most 25 customers, each read in
 * the same organization under the caller's own access.
 */
export async function loadDialerQueue(db: Db, organizationId: string): Promise<{ items: DialerQueueEntry[]; total: number }> {
  const tasks = await listTasks(db, { organizationId, status: 'open', kind: 'call', limit: 25 });
  const ids = [...new Set(tasks.map(item => item.customerId))];
  const context = new Map(await Promise.all(ids.map(async customerId => {
    const [customer, calls] = await Promise.all([
      getContact(db, { organizationId, customerId }),
      listCallPage(db, { organizationId, filter: { customerId }, limit: RECENT_CALLS_PER_CUSTOMER }),
    ]);
    return [customerId, { customer, recentCalls: calls.items }] as const;
  })));
  return {
    items: tasks.map(task => ({ task, customer: context.get(task.customerId)?.customer ?? null, recentCalls: context.get(task.customerId)?.recentCalls ?? [] })),
    total: tasks.total,
  };
}
