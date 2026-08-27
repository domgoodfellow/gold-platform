'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createCustomer } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';
import { CUSTOM_FIELD_PREFIX } from '@/lib/domain/fields/field-definitions';

export type CreateCustomerState = { error: string | null };

export async function createCustomerAction(
  _previous: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  // Transport decoding, not a business rule: strip the prefix the form puts on custom
  // fields and hand the raw strings over. Which keys are legal, what they coerce to, and
  // which are required are all decided by the domain layer against the tenant's registry.
  const custom: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith(CUSTOM_FIELD_PREFIX) && typeof value === 'string') {
      custom[name.slice(CUSTOM_FIELD_PREFIX.length)] = value;
    }
  }

  try {
    await createCustomer(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      custom,
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
