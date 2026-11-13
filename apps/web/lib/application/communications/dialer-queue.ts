import type { Db } from '@/lib/db/types';
import { listTasks, type CrmTask } from '@/lib/domain/tasks/tasks';
import { callListContacts, listCallPage, type Call, type CallContact } from '@/lib/domain/reception/calls';

/** How many of a queued customer's most recent recorded calls the Dialer shows beside them. */
export const RECENT_CALLS_PER_CUSTOMER = 3;

export type DialerQueueEntry = { task: CrmTask; customer: CallContact | null; recentCalls: Call[] };

/**
 * The Dialer's call list: the first page of open Call tasks, earliest due first, with each listed
 * contact's name, email and number and their few most recent recorded calls. Contacts are read
 * through `call_list_contacts`, the Dialer's own disclosure: placing calls shows who is on the
 * list without opening the contact directory. Bounded by the page: at most 25 contacts.
 */
export async function loadDialerQueue(db: Db, organizationId: string): Promise<{ items: DialerQueueEntry[]; total: number }> {
  const tasks = await listTasks(db, { organizationId, status: 'open', kind: 'call', limit: 25 });
  const ids = [...new Set(tasks.map(item => item.customerId))];
  const [contacts, history] = await Promise.all([
    callListContacts(db, { organizationId, customerIds: ids }),
    Promise.all(ids.map(async customerId => [customerId, (await listCallPage(db, { organizationId, filter: { customerId }, limit: RECENT_CALLS_PER_CUSTOMER })).items] as const)),
  ]);
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  const context = new Map(history.map(([customerId, recentCalls]) => [customerId, { customer: byId.get(customerId) ?? null, recentCalls }] as const));
  return {
    items: tasks.map(task => ({ task, customer: context.get(task.customerId)?.customer ?? null, recentCalls: context.get(task.customerId)?.recentCalls ?? [] })),
    total: tasks.total,
  };
}
