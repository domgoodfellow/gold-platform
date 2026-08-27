'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { createFieldDefinition } from '@/lib/domain/fields/field-definitions';
import { DomainError } from '@/lib/domain/errors';

export type CreateFieldState = { error: string | null };

export async function createFieldAction(
  _previous: CreateFieldState,
  formData: FormData,
): Promise<CreateFieldState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createFieldDefinition(db, {
      organizationId,
      // Fixed rather than submitted, because `customer` is the only entity that carries
      // custom fields today. This becomes a selector in the change that adds the second one,
      // not before.
      entityType: 'customer',
      key: String(formData.get('key') ?? ''),
      label: String(formData.get('label') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      // An unticked checkbox is absent from the payload rather than false.
      required: formData.get('required') !== null,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  // As on the customers action: the organization id comes from a hidden field a client could
  // edit, and it is deliberately not re-checked here. `field_definitions_insert` requires
  // both membership and field.manage, so tampering produces a refusal rather than a leak.
  revalidatePath(`/organizations/${organizationId}/fields`);
  return { error: null };
}
