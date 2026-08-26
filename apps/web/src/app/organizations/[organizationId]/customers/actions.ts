'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createCustomer } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';

export type CreateCustomerState = { error: string | null };

export async function createCustomerAction(
  _previous: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createCustomer(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // The organization id arrives from a hidden field, which a client could edit. That is
  // fine and deliberately not re-validated here: RLS refuses an insert into an organization
  // the caller does not belong to, so tampering produces a refusal rather than a leak.
  revalidatePath(`/organizations/${organizationId}/customers`);
  return { error: null };
}
