'use server';

import { revalidatePath } from 'next/cache';
import { archiveContact, deleteContact, restoreContact } from '@/lib/domain/contacts/contacts';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';

export type ContactRemovalResult = { error: string | null };

type Operation = typeof archiveContact;

/**
 * Archive, restore and permanent deletion of one contact. Each is `customer.delete`, checked by the
 * database function itself; this only reports its refusal in words a person can act on.
 */
async function run(operation: Operation, organizationId: string, contactId: string): Promise<ContactRemovalResult> {
  const { db } = await requireOrganization(organizationId);
  try {
    await operation(db, { organizationId, contactId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/organizations/${organizationId}/crm/contacts`, 'layout');
  revalidatePath(`/organizations/${organizationId}/crm`);
  return { error: null };
}

export async function archiveContactAction(organizationId: string, contactId: string): Promise<ContactRemovalResult> {
  return run(archiveContact, organizationId, contactId);
}

export async function restoreContactAction(organizationId: string, contactId: string): Promise<ContactRemovalResult> {
  return run(restoreContact, organizationId, contactId);
}

export async function deleteContactAction(organizationId: string, contactId: string): Promise<ContactRemovalResult> {
  return run(deleteContact, organizationId, contactId);
}
