import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listContactPhones, listContactPhonesMatching, listContacts } from '@/lib/domain/contacts/contacts';
import { createCallTasks, openCallCustomerIds } from '@/lib/domain/tasks/tasks';
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
/** The reason recorded when the person adding does not give one. */
export const DEFAULT_CALL_REASON = 'Call';

export type CallListCandidate = { id: string; name: string; phone: string | null; onList: boolean };
/** Who an add is for: contacts chosen by id, or every contact matching a Contacts directory view. */
export type CallListTarget = { customerIds: readonly string[] } | { view: ContactDirectoryQuery };
export type CallListPlan = { matching: number; toAdd: string[]; alreadyOnList: number; noPhone: number };
export type CallListTaskDraft = { dueAt: string; ownerMembershipId: string; notes: string };

/**
 * Whether this member may put people on the call list: the business has the Dialer (the
 * Communications workspace's calling area) and Tasks, and the member may manage tasks. Every way
 * in (Dialer, Contacts, a contact's page) shows Add to only when this holds, and every write checks it.
 */
export async function callListAvailable(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<boolean> {
  if (!organization.capabilities.includes('follow_up.manage')) return false;
  const states = await organizationResolvedFeatureStates(db, { organizationId: organization.id });
  const features = availableFeatureKeys(states);
  if (!features.has('follow_ups')) return false;
  return areaAvailable('calls', { enabled: activeModuleKeys(states), capabilities: new Set(organization.capabilities), featureAvailability: features });
}

export async function assertCallListAccess(db: Db, organization: Pick<Organization, 'id' | 'capabilities'>): Promise<void> {
  if (!await callListAvailable(db, organization)) throw new DomainError('Your role or this business’s plan does not include the call list.', 'call_list.unavailable');
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
    const ids = [...new Set(input.target.customerIds.filter(Boolean))];
    if (!ids.length) throw new DomainError('Choose at least one contact.', 'call_list.empty');
    if (ids.length > CALL_LIST_ADD_LIMIT) throw new DomainError(`Add up to ${CALL_LIST_ADD_LIMIT} contacts at a time.`, 'call_list.too_many');
    const found = await listContactPhones(db, { organizationId: input.organizationId, ids });
    if (found.size !== ids.length) throw new DomainError('One or more of these contacts is no longer available.', 'call_list.unknown_contact');
    phones = found;
  }
  const ids = [...phones.keys()];
  const onList = await openCallCustomerIds(db, { organizationId: input.organizationId, customerIds: ids });
  const withPhone = ids.filter(id => Boolean(phones.get(id)?.trim()));
  return {
    matching: ids.length,
    toAdd: withPhone.filter(id => !onList.has(id)),
    alreadyOnList: ids.filter(id => onList.has(id)).length,
    noPhone: ids.filter(id => !onList.has(id) && !phones.get(id)?.trim()).length,
  };
}

/**
 * Puts contacts on the Dialer's call list: one open Call task each, due now and unassigned, with
 * the reason given or `DEFAULT_CALL_REASON`. Anyone already on the list, or with no phone number,
 * is skipped and counted, never added twice. All are added in one statement or none is. The caller
 * has already checked `assertCallListAccess`; the database checks task permission again.
 */
export async function addToCallList(db: Db, input: { organizationId: string; target: CallListTarget; reason?: string; now?: Date; dueAt?: string; ownerMembershipId?: string; notes?: string }): Promise<{ added: number; alreadyOnList: number; noPhone: number }> {
  const plan = await planCallListAdd(db, input);
  const added = await createCallTasks(db, {
    organizationId: input.organizationId,
    customerIds: plan.toAdd,
    title: input.reason?.trim() || DEFAULT_CALL_REASON,
    dueAt: input.dueAt ?? (input.now ?? new Date()).toISOString(),
    ownerMembershipId: input.ownerMembershipId, notes: input.notes,
  });
  return { added, alreadyOnList: plan.alreadyOnList, noPhone: plan.noPhone };
}
