'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import {
  addToCallList, assertCallListAccess, findCallListCandidates, planCallListAdd, removeFromCallList, reviewCallListAdd,
  type CallListCandidate, type CallListOutcome, type CallListReviewEntry, type CallListTarget, type CallListTaskDraft,
} from '@/lib/application/communications/call-list';
import { listFieldDefinitions, type FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { listMembers } from '@/lib/domain/tenancy/members';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import { assertTaskManagement, followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { CALL_LIST_PAGE_SIZE } from '@/lib/domain/tasks/call-list-views';
import { callListQuery, loadCallList, nextCallListEntry, type CallListPage, type CallListQuery, type DialerQueueEntry } from '@/lib/application/communications/dialer-queue';
import { listCallListEntries, reassignCallTask, rescheduleCallTask, scheduleCallback } from '@/lib/domain/tasks/call-list';
import { changeTaskStatus } from '@/lib/domain/tasks/tasks';
import { listCallPage } from '@/lib/domain/reception/calls';
import { recentCallRows, type RecentCallRow } from '@/features/communications/voice/format';
import type { Db } from '@/lib/db/types';

export type AddToCallListResult = { error: string | null; added: number; alreadyOnList: number; noPhone: number; conflicts: number; outcomes: Record<string, CallListOutcome> };
export type CallListPreview = { error: string | null; matching: number; toAdd: number; alreadyOnList: number; noPhone: number };

const NOTHING_ADDED = { added: 0, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: {} };

/** The business's timezone, the present moment in it and its members: what a due date and an owner are chosen from. */
async function taskOptions(db: Db, organization: { id: string; timezone: string }) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (key: string) => parts.find(part => part.type === key)!.value;
  return { timezone: organization.timezone, dueAt: `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`,
    members: (await listMembers(db, { organizationId: organization.id })).map(member => ({ id: member.id, name: member.displayName })) };
}

export async function callListTaskOptions(organizationId: string) {
  const { db, organization } = await requireOrganization(organizationId);
  await assertCallListAccess(db, organization);
  return taskOptions(db, organization);
}

/** The same choices for changing a call already on the list: its time and its owner. Needs task permission. */
export async function callTaskEditOptions(organizationId: string) {
  const { db, organization } = await requireOrganization(organizationId);
  await assertTaskManagement(db, organization);
  return taskOptions(db, organization);
}

/** Contacts for the Dialer's Add to list, each marked when already on the call list. */
export async function findCallListContacts(organizationId: string, search: string): Promise<{ error: string | null; contacts: CallListCandidate[] }> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    return { error: null, contacts: await findCallListCandidates(db, { organizationId, search }) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, contacts: [] };
    throw error;
  }
}

/** The Add to list review: the chosen contacts as they stand now, read again rather than remembered. */
export async function reviewCallListContacts(organizationId: string, customerIds: string[]): Promise<{ error: string | null; entries: CallListReviewEntry[] }> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    return { error: null, entries: await reviewCallListAdd(db, { organizationId, customerIds }) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, entries: [] };
    throw error;
  }
}

/**
 * The business's own contact fields, for creating a contact inside Add to list. Offered only to a
 * member who may add contacts; the canonical creation command checks that again when saving.
 */
export async function callListContactFields(organizationId: string): Promise<{ error: string | null; definitions: FieldDefinition[] }> {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('customer.create')) return { error: 'Your role cannot add contacts.', definitions: [] };
  return { error: null, definitions: await listFieldDefinitions(db, { organizationId, entityType: 'customer' }) };
}

/** What adding would do, before anything is written: how many would be added and why the rest are skipped. */
export async function previewAddToCallList(organizationId: string, target: CallListTarget): Promise<CallListPreview> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    const plan = await planCallListAdd(db, { organizationId, target });
    return { error: null, matching: plan.matching, toAdd: plan.toAdd.length, alreadyOnList: plan.alreadyOnList.length, noPhone: plan.noPhone.length };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, matching: 0, toAdd: 0, alreadyOnList: 0, noPhone: 0 };
    throw error;
  }
}

/** Puts contacts on the call list. Anyone already on it, or with no phone number, is skipped and counted. */
export async function addToCallListAction(organizationId: string, target: CallListTarget, reason: string, details?: CallListTaskDraft): Promise<AddToCallListResult> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    const result = await addToCallList(db, { organizationId, target, reason, ...(details ? { dueAt: localDateTimeToInstant(details.dueAt, organization.timezone), ownerMembershipId: details.ownerMembershipId, notes: details.notes } : {}) });
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null, ...result };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, ...NOTHING_ADDED };
    throw error;
  }
}

/** Takes one contact off the call list by cancelling their open Call task. Needs `call_list.remove`. */
export async function removeFromCallListAction(organizationId: string, taskId: string): Promise<{ error: string | null }> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await removeFromCallList(db, organization, taskId);
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

const EMPTY_COUNTS = { all: 0, mine: 0, due: 0, overdue: 0, upcoming: 0, callbacks: 0 };
export type CallListLoad = CallListPage & { error: string | null };

/** The Dialer and Tasks, for someone who may open the Dialer at all. */
async function callListContext(organizationId: string) {
  const context = await requireOperatingArea(organizationId, 'calls');
  if (!await followUpsAvailable(context.db, organizationId)) throw new DomainError('Tasks are not included for this business, so there is no call list.', 'call_list.unavailable');
  return context;
}

/**
 * One page of the call list for a view and search, with every view's count. A failed read is an
 * error, never an empty list: the Dialer must not claim there is nobody to call.
 */
export async function loadCallListAction(organizationId: string, query: Partial<CallListQuery>, page: { offset?: number; limit?: number; selectedId?: string | null } = {}): Promise<CallListLoad> {
  try {
    const { db } = await callListContext(organizationId);
    return { error: null, ...await loadCallList(db, organizationId, callListQuery(query), { offset: page.offset, limit: page.limit ?? CALL_LIST_PAGE_SIZE, selectedId: page.selectedId }) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, items: [], counts: EMPTY_COUNTS, total: 0 };
    throw error;
  }
}

/** Who a calling session moves to next; `passed` are the calls already made this session. */
export async function nextCallListEntryAction(organizationId: string, query: Partial<CallListQuery>, passed: string[]): Promise<{ error: string | null; entry: DialerQueueEntry | null }> {
  try {
    const { db } = await callListContext(organizationId);
    return { error: null, entry: await nextCallListEntry(db, organizationId, callListQuery(query), passed) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, entry: null };
    throw error;
  }
}

/** How many of a listed contact's recent calls the Dialer shows beside them. */
const RECENT_CALLS_PER_CONTACT = 3;

/**
 * One call list entry as it stands now, with the contact's recent calls. `entry` is null when the
 * task is no longer on the list (completed, removed or cancelled by anyone), which is how a stale
 * selection is noticed before it is called.
 */
export async function callListEntryAction(organizationId: string, taskId: string): Promise<{ error: string | null; entry: DialerQueueEntry | null; recentCalls: RecentCallRow[] }> {
  try {
    const { db, organization } = await callListContext(organizationId);
    const [entry] = await listCallListEntries(db, { organizationId, taskIds: [taskId], limit: 1 });
    if (!entry) return { error: null, entry: null, recentCalls: [] };
    const recent = await listCallPage(db, { organizationId, filter: { customerId: entry.customer.id }, limit: RECENT_CALLS_PER_CONTACT });
    return { error: null, entry, recentCalls: recentCallRows(recent.items, organization.timezone) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, entry: null, recentCalls: [] };
    throw error;
  }
}

async function changeCallTask(organizationId: string, run: (context: Awaited<ReturnType<typeof requireOrganization>>) => Promise<unknown>): Promise<{ error: string | null }> {
  try {
    const context = await requireOrganization(organizationId);
    await assertTaskManagement(context.db, context.organization);
    await run(context);
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Moves a call to another time (given in the business's timezone). The same task; nothing is duplicated. */
export async function rescheduleCallTaskAction(organizationId: string, taskId: string, dueAt: string): Promise<{ error: string | null }> {
  return changeCallTask(organizationId, ({ db, organization }) => rescheduleCallTask(db, { organizationId, taskId, dueAt: localDateTimeToInstant(dueAt, organization.timezone) }));
}

/** Gives a call to another member, or to nobody. */
export async function reassignCallTaskAction(organizationId: string, taskId: string, ownerMembershipId: string): Promise<{ error: string | null }> {
  return changeCallTask(organizationId, ({ db }) => reassignCallTask(db, { organizationId, taskId, ownerMembershipId: ownerMembershipId || null }));
}

/** Marks a call task done through the canonical task operation. Hanging up never does this by itself. */
export async function completeCallTaskAction(organizationId: string, taskId: string): Promise<{ error: string | null }> {
  return changeCallTask(organizationId, ({ db }) => changeTaskStatus(db, { organizationId, id: taskId, status: 'completed' }));
}

/** Schedules the callback a call ended with: the contact's one open Call task moves, or is opened with the reason given. */
export async function scheduleCallbackAction(organizationId: string, callId: string, dueAt: string, reason?: string): Promise<{ error: string | null }> {
  return changeCallTask(organizationId, ({ db, organization }) => scheduleCallback(db, { organizationId, callId, dueAt: localDateTimeToInstant(dueAt, organization.timezone), reason }));
}
