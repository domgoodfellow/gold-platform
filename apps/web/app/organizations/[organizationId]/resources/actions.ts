'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import { createResource, setResourceMembership } from '@/lib/domain/resources/resources';
import { requireOrganization } from '@/lib/route/organization';

export type CreateResourceState = { error: string | null; created: boolean };

export async function createResourceAction(
  _previous: CreateResourceState,
  formData: FormData,
): Promise<CreateResourceState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  const membershipId = String(formData.get('membershipId') ?? '').trim();

  try {
    await createResource(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      custom: customValuesFromFormData(formData),
      membershipId: membershipId.length > 0 ? membershipId : null,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, created: false };
    }
    throw error;
  }

  // The organization id comes from a hidden field and is deliberately not re-checked here:
  // `resources_insert` requires both membership and resource.create, so tampering produces
  // a refusal rather than a leak.
  revalidatePath(`/organizations/${organizationId}/resources`);
  // A new resource is a new Schedule lane and a new Field count.
  revalidatePath(`/organizations/${organizationId}/schedule`);
  revalidatePath(`/organizations/${organizationId}/field`);
  return { error: null, created: true };
}

export type SetResourceMembershipState = { error: string | null };

/**
 * Link, change or clear the Membership a Resource represents. Not gated a second time here —
 * `resources_update` requires `resource.update`, so a caller without it is refused by the
 * database whether it arrives through this action or a direct RPC call (I12).
 */
export async function setResourceMembershipAction(
  _previous: SetResourceMembershipState,
  formData: FormData,
): Promise<SetResourceMembershipState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '').trim();
  await requireOrganization(organizationId);

  try {
    await setResourceMembership(db, {
      resourceId,
      membershipId: membershipId.length > 0 ? membershipId : null,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/resources/${resourceId}`);
  revalidatePath(`/organizations/${organizationId}/resources`);
  return { error: null };
}
