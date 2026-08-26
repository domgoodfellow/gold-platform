'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { createRole } from '@/lib/domain/tenancy/roles';

export type CreateRoleState = { error: string | null };

export async function createRoleAction(
  _previous: CreateRoleState,
  formData: FormData,
): Promise<CreateRoleState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createRole(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      // getAll, because capabilities are checkboxes and an unchecked box sends nothing.
      capabilities: formData.getAll('capabilities').map(String),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/roles`);
  return { error: null };
}
