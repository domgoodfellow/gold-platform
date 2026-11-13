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

export type AddToCallListResult = { error: string | null; added: number; alreadyOnList: number; noPhone: number; conflicts: number; outcomes: Record<string, CallListOutcome> };
export type CallListPreview = { error: string | null; matching: number; toAdd: number; alreadyOnList: number; noPhone: number };

const NOTHING_ADDED = { added: 0, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: {} };

export async function callListTaskOptions(organizationId: string) {
  const { db, organization } = await requireOrganization(organizationId);
  await assertCallListAccess(db, organization);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (key: string) => parts.find(part => part.type === key)!.value;
  return { timezone: organization.timezone, dueAt: `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`,
    members: (await listMembers(db, { organizationId })).map(member => ({ id: member.id, name: member.displayName })) };
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
