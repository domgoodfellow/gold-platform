import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listContactPhonesMatching, listContactSummaries, listContacts } from '@/lib/domain/contacts/contacts';
import { createCallTasks, openCallCustomerIds, removeFromCallList as cancelCallTask } from '@/lib/domain/tasks/tasks';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { areaAvailable } from '@/lib/navigation';
import { directoryFilter, type ContactDirectoryQuery } from '@/lib/application/crm/contact-directory';

/** How many contacts the Dialer's picker shows for one search. */
export const CALL_LIST_SEARCH_LIMIT = 25;
/** How many chosen contacts one add may name. */
export const CALL_LIST_ADD_LIMIT = 50;
/** How many contacts "everyone matching this view" may add at once; a larger view is refused, never cut short. */
export const CALL_LIST_MATCHING_LIMIT = 500;
/** The longest reason for calling a Call task can hold. */
export const CALL_REASON_MAX = 200;

export type CallListCandidate = { id: string; name: string; phone: string | null; onList: boolean };
/** Who an add is for: contacts chosen by id, or every contact matching a Contacts directory view. */
export type CallListTarget = { customerIds: readonly string[] } | { view: ContactDirectoryQuery };
/** Where one contact stands before an add: can be added, already on the list, or has no phone number. */
export type CallListStanding = 'ready' | 'on-list' | 'no-phone';
export type CallListPlan = { matching: number; toAdd: string[]; alreadyOnList: string[]; noPhone: string[] };
/** What an add actually did for each contact named. `conflict`: someone else added them in the meantime. */
export type CallListOutcome = 'added' | 'on-list' | 'no-phone' | 'conflict';
export type CallListAddResult = { added: number; alreadyOnList: number; noPhone: number; conflicts: number; outcomes: Record<string, CallListOutcome> };
export type CallListReviewEntry = CallListCandidate & { standing: CallListStanding };
export type CallListTaskDraft = { dueAt: string; ownerMembershipId: string; notes: string };

/** Whether the business has the Dialer (the Communications calling area) and Tasks at all. */
async function callListIncluded(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<boolean> {
  const states = await organizationResolvedFeatureStates(db, { organizationId: organization.id });
  const features = availableFeatureKeys(states);
  if (!features.has('follow_ups')) return false;
  return areaAvailable('calls', { enabled: activeModuleKeys(states), capabilities: new Set(organization.capabilities), featureAvailability: features });
}

/**
 * Whether this member may put people on the call list: the business has the Dialer and Tasks, and
 * the member may manage tasks and view contacts (choosing who to call is browsing contacts; the
 * database adds only contacts the caller can see). Every way in (Dialer, Contacts, a contact's
 * page) shows Add to only when this holds, and every write checks it.
 */
export async function callListAvailable(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<boolean> {
  if (!organization.capabilities.includes('follow_up.manage') || !organization.capabilities.includes('customer.read')) return false;
  return callListIncluded(db, organization);
}

export async function assertCallListAccess(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<void> {
  if (!await callListAvailable(db, organization)) throw new DomainError('Your role or this business’s plan does not include the call list.', 'call_list.unavailable');
}

/**
 * Whether this member may take people off the call list. Its own permission, `call_list.remove`:
 * managing tasks does not include it, and the database refuses removal without it however it is tried.
 */
export async function callListRemovalAvailable(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<boolean> {
  if (!organization.capabilities.includes('call_list.remove')) return false;
  return callListIncluded(db, organization);
}

/** Takes the contact behind one Call task off the call list. Nothing else about them changes. */
export async function removeFromCallList(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>, taskId: string): Promise<void> {
  if (!await callListRemovalAvailable(db, organization)) throw new DomainError('Your role cannot remove contacts from the call list.', 'call_list.remove_forbidden');
  await cancelCallTask(db, { organizationId: organization.id, taskId });
}

/**
 * Contacts the Dialer's Add to list can offer, read under the caller's own access, each marked
 * when it is already on the call list (it has an open Call task).
 */
export async function findCallListCandidates(db: Db, input: { organizationId: string; search?: string }): Promise<CallListCandidate[]> {
  const contacts = await listContacts(db, { organizationId: input.organizationId, search: input.search, limit: CALL_LIST_SEARCH_LIMIT });
  const onList = await openCallCustomerIds(db, { organizationId: input.organizationId, customerIds: contacts.map(contact => contact.id) });
  return contacts.map(({ id, name, phone }) => ({ id, name, phone, onList: onList.has(id) }));
}

/** A reason a person would recognise later, or a refusal: the call list never invents one. */
export function callReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) throw new DomainError('Enter the reason for calling.', 'call_list.reason_missing');
  if (trimmed.length > CALL_REASON_MAX) throw new DomainError(`Keep the reason to ${CALL_REASON_MAX} characters.`, 'call_list.reason_too_long');
  return trimmed;
}

function chosenIds(customerIds: readonly string[]): string[] {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (!ids.length) throw new DomainError('Choose at least one contact.', 'call_list.empty');
  if (ids.length > CALL_LIST_ADD_LIMIT) throw new DomainError(`Add up to ${CALL_LIST_ADD_LIMIT} contacts at a time.`, 'call_list.too_many');
  return ids;
}

/**
 * Who an add would reach and who it would skip: someone already on the list, or with no phone
 * number. Read under the caller's own access, so a contact of another business is simply absent.
 */
export async function planCallListAdd(db: Db, input: { organizationId: string; target: CallListTarget; matchingLimit?: number }): Promise<CallListPlan> {
  let phones: Map<string, string | null>;
  if ('view' in input.target) {
    const limit = input.matchingLimit ?? CALL_LIST_MATCHING_LIMIT;
    const matching = await listContactPhonesMatching(db, { organizationId: input.organizationId, filter: directoryFilter(input.target.view), limit });
    if (matching.total > limit) throw new DomainError(`More than ${limit} contacts match. Narrow the search or filters first.`, 'call_list.too_many');
    phones = new Map(matching.map(row => [row.id, row.phone]));
  } else {
    const ids = chosenIds(input.target.customerIds);
    const found = await listContactSummaries(db, { organizationId: input.organizationId, ids });
    if (found.size !== ids.length) throw new DomainError('One or more of these contacts is no longer available.', 'call_list.unknown_contact');
    phones = new Map(ids.map(id => [id, found.get(id)!.phone]));
  }
  const ids = [...phones.keys()];
  const onList = await openCallCustomerIds(db, { organizationId: input.organizationId, customerIds: ids });
  const hasPhone = (id: string) => Boolean(phones.get(id)?.trim());
  return {
    matching: ids.length,
    toAdd: ids.filter(id => hasPhone(id) && !onList.has(id)),
    alreadyOnList: ids.filter(id => onList.has(id)),
    noPhone: ids.filter(id => !onList.has(id) && !hasPhone(id)),
  };
}

/**
 * The review step's fresh look at chosen contacts: each one's name, phone and standing as the
 * database has it now, not as it was when they were picked.
 */
export async function reviewCallListAdd(db: Db, input: { organizationId: string; customerIds: readonly string[] }): Promise<CallListReviewEntry[]> {
  const ids = chosenIds(input.customerIds);
  const [found, onList] = await Promise.all([
    listContactSummaries(db, { organizationId: input.organizationId, ids }),
    openCallCustomerIds(db, { organizationId: input.organizationId, customerIds: ids }),
  ]);
  if (found.size !== ids.length) throw new DomainError('One or more of these contacts is no longer available.', 'call_list.unknown_contact');
  return ids.map(id => {
    const { name, phone } = found.get(id)!;
    const standing: CallListStanding = onList.has(id) ? 'on-list' : phone?.trim() ? 'ready' : 'no-phone';
    return { id, name, phone, onList: onList.has(id), standing };
  });
}

/**
 * Puts contacts on the Dialer's call list: one open Call task each, with the reason given, due when
 * asked (now by default). Anyone already on the list, or with no phone number, is skipped and
 * counted, never added twice; someone another person added in the meantime counts as a conflict.
 * All eligible contacts are added in one statement or none is. The caller has already checked
 * `assertCallListAccess`; the database checks task permission again.
 */
export async function addToCallList(db: Db, input: { organizationId: string; target: CallListTarget; reason?: string; now?: Date; dueAt?: string; ownerMembershipId?: string; notes?: string }): Promise<CallListAddResult> {
  const title = callReason(input.reason);
  const plan = await planCallListAdd(db, input);
  const added = new Set(await createCallTasks(db, {
    organizationId: input.organizationId,
    customerIds: plan.toAdd,
    title,
    dueAt: input.dueAt ?? (input.now ?? new Date()).toISOString(),
    ownerMembershipId: input.ownerMembershipId, notes: input.notes,
  }));
  const outcomes: Record<string, CallListOutcome> = {};
  for (const id of plan.alreadyOnList) outcomes[id] = 'on-list';
  for (const id of plan.noPhone) outcomes[id] = 'no-phone';
  for (const id of plan.toAdd) outcomes[id] = added.has(id) ? 'added' : 'conflict';
  return { added: added.size, alreadyOnList: plan.alreadyOnList.length, noPhone: plan.noPhone.length, conflicts: plan.toAdd.length - added.size, outcomes };
}
