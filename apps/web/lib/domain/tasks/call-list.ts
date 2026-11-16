import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { memberDisplayNames } from '@/lib/domain/tenancy/members';
import type { CallContact } from '@/lib/domain/reception/calls';
import type { CrmTask } from './tasks';
import type { CallListCounts, CallListView } from './call-list-views';

/**
 * The Dialer's call list as the database reads it: open Call tasks with the contact each is for.
 * A view and its count come from the same rows (`app.call_list_rows`), so they cannot disagree.
 * The views themselves are named in `call-list-views.ts`.
 */
export { CALL_LIST_VIEWS, isCallListView, type CallListCounts, type CallListView } from './call-list-views';

/** Where one entry stands, as the database computed it when the list was read. */
export type CallListStanding = { mine: boolean; due: boolean; overdue: boolean; callback: boolean };
export type CallListEntry = { task: CrmTask; customer: CallContact; standing: CallListStanding };

export type CallListFilter = {
  organizationId: string;
  view?: CallListView;
  search?: string;
  /** Tasks left out of the rows and of every count: those skipped for a calling session. */
  exclude?: readonly string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Task ids as the database will accept them: well-formed, once each, and a bounded number. */
export function taskIds(ids: readonly string[] | undefined, limit = 500): string[] {
  return [...new Set((ids ?? []).filter(id => typeof id === 'string' && UUID.test(id)))].slice(0, limit);
}

function refused(error: { code?: string; message: string }, code: string): DomainError {
  if (error.code === '42501') return new DomainError('Your role cannot see the call list.', 'call_list.forbidden');
  return fromDatabaseError(error, code);
}

/**
 * One page of a view, earliest due first. `taskIds` narrows to named tasks (reading a selection
 * again, whatever view it was chosen in); `callableOnly` leaves out contacts with no phone number.
 */
export async function listCallListEntries(db: Db, input: CallListFilter & { limit?: number; offset?: number; taskIds?: readonly string[]; callableOnly?: boolean }): Promise<CallListEntry[]> {
  const { data, error } = await db.rpc('call_list_page', {
    p_organization_id: input.organizationId,
    p_view: input.view ?? 'all',
    p_search: input.search?.trim() || undefined,
    p_exclude: taskIds(input.exclude),
    p_limit: input.limit ?? 25,
    p_offset: input.offset ?? 0,
    p_task_ids: input.taskIds ? taskIds(input.taskIds) : undefined,
    p_callable_only: input.callableOnly ?? false,
  });
  if (error) throw refused(error, 'call_list.read_failed');
  const rows = data ?? [];
  const names = rows.some(row => row.owner_membership_id) ? await memberDisplayNames(db, input.organizationId) : new Map<string, string>();
  return rows.map(row => ({
    task: {
      id: row.id, customerId: row.customer_id, customerName: row.contact_name, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title,
      kind: 'call', title: row.title, notes: row.notes, dueAt: row.due_at, ownerMembershipId: row.owner_membership_id,
      ownerName: row.owner_membership_id ? names.get(row.owner_membership_id) ?? 'Member' : null,
      status: 'open', completedAt: null, createdAt: row.created_at,
    },
    customer: {
      id: row.customer_id, name: row.contact_name, email: row.contact_email, phone: row.contact_phone, archived: row.contact_archived,
      contactType: row.contact_type as CallContact['contactType'], companyId: row.company_id, companyName: row.company_name, title: row.contact_title,
    },
    standing: { mine: row.is_mine, due: row.is_due, overdue: row.is_overdue, callback: row.callback_of_call_id !== null },
  }));
}

/** How many calls each view holds for this search, with the same tasks left out. */
export async function callListCounts(db: Db, input: Omit<CallListFilter, 'view'>): Promise<CallListCounts> {
  const { data, error } = await db.rpc('call_list_counts', {
    p_organization_id: input.organizationId,
    p_search: input.search?.trim() || undefined,
    p_exclude: taskIds(input.exclude),
  });
  if (error) throw refused(error, 'call_list.count_failed');
  const row = (data ?? [])[0];
  return { all: Number(row?.all_calls ?? 0), mine: Number(row?.mine ?? 0), due: Number(row?.due ?? 0), overdue: Number(row?.overdue ?? 0), upcoming: Number(row?.upcoming ?? 0), callbacks: Number(row?.callbacks ?? 0) };
}

const GONE = 'This contact is no longer on the call list.';

async function changeOpenCallTask(db: Db, input: { organizationId: string; taskId: string }, change: { due_at: string } | { owner_membership_id: string | null }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db.from('crm_tasks').update(change)
    .eq('organization_id', input.organizationId).eq('id', input.taskId).eq('status', 'open').eq('kind', 'call').select('id');
  if (error) throw fromDatabaseError(error, 'call_list.change_failed');
  // Row security hides the task from a member who may not manage tasks, so nothing changes for them either.
  if (!data.length) throw new DomainError(GONE, 'call_list.not_listed');
}

/** Moves one open Call task to another time. The same task: nothing is created or cancelled. */
export async function rescheduleCallTask(db: Db, input: { organizationId: string; taskId: string; dueAt: string }): Promise<void> {
  if (!Number.isFinite(Date.parse(input.dueAt))) throw new DomainError('Enter a valid date and time.', 'call_list.due_invalid');
  await changeOpenCallTask(db, input, { due_at: new Date(input.dueAt).toISOString() });
}

/** Gives one open Call task to another member, or to nobody. */
export async function reassignCallTask(db: Db, input: { organizationId: string; taskId: string; ownerMembershipId: string | null }): Promise<void> {
  await changeOpenCallTask(db, input, { owner_membership_id: input.ownerMembershipId || null });
}

/**
 * Schedules the callback a call ended with. The contact's one open Call task is moved to the new
 * time and marked as following that call; when they have none, one is opened with the reason
 * given. Never a second open Call task. Returns the task.
 */
export async function scheduleCallback(db: Db, input: { organizationId: string; callId: string; dueAt: string; reason?: string }): Promise<string> {
  await requireActor(db);
  if (!Number.isFinite(Date.parse(input.dueAt))) throw new DomainError('Enter when to call back.', 'call_list.due_invalid');
  const { data, error } = await db.rpc('schedule_callback', {
    p_organization_id: input.organizationId, p_call_id: input.callId, p_due_at: new Date(input.dueAt).toISOString(),
    p_reason: input.reason?.trim() || undefined,
  });
  if (!error) return data as string;
  if (error.code === '42501') throw new DomainError('Your role cannot schedule callbacks.', 'call_list.callback_forbidden');
  if (error.code === 'P0002') throw new DomainError('That call could not be found.', 'call_list.call_missing');
  throw fromDatabaseError(error, 'call_list.callback_failed');
}
