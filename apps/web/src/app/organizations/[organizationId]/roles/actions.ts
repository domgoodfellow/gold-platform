'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addMember } from '@/lib/domain/tenancy/members';
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

export type AddMemberState = { error: string | null };

export async function addMemberAction(
  _previous: AddMemberState,
  formData: FormData,
): Promise<AddMemberState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // Neither the organization id nor the role id is re-checked here. `add_member_by_email`
    // asserts role.manage itself — it is SECURITY DEFINER, so RLS is not doing it — and the
    // composite foreign key refuses a role belonging to another organization.
    await addMember(db, {
      organizationId,
      email: String(formData.get('email') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
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
