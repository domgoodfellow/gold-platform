'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import {
  addToCallList, assertCallListAccess, findCallListCandidates, planCallListAdd,
  type CallListCandidate, type CallListTarget,
} from '@/lib/application/communications/call-list';

export type AddToCallListResult = { error: string | null; added: number; alreadyOnList: number; noPhone: number };
export type CallListPreview = { error: string | null; matching: number; toAdd: number; alreadyOnList: number; noPhone: number };

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

/** What adding would do, before anything is written: how many would be added and why the rest are skipped. */
export async function previewAddToCallList(organizationId: string, target: CallListTarget): Promise<CallListPreview> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    const plan = await planCallListAdd(db, { organizationId, target });
    return { error: null, matching: plan.matching, toAdd: plan.toAdd.length, alreadyOnList: plan.alreadyOnList, noPhone: plan.noPhone };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, matching: 0, toAdd: 0, alreadyOnList: 0, noPhone: 0 };
    throw error;
  }
}

/** Puts contacts on the call list. Anyone already on it, or with no phone number, is skipped and counted. */
export async function addToCallListAction(organizationId: string, target: CallListTarget, reason: string): Promise<AddToCallListResult> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    await assertCallListAccess(db, organization);
    const result = await addToCallList(db, { organizationId, target, reason });
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null, ...result };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, added: 0, alreadyOnList: 0, noPhone: 0 };
    throw error;
  }
}
