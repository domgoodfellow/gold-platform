'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import {
  assignResourceCapability,
  createResourceCapability,
  listResourceCapabilities,
  removeResourceCapability,
  renameResourceCapability,
  setResourceCapabilityArchived,
} from '@/lib/domain/resources/resource-capabilities';
import { isResourceClass } from '@/lib/domain/resources/resource-class';
import {
  createResource,
  setResourceClass,
  setResourceMembership,
} from '@/lib/domain/resources/resources';
import type { Db } from '@/lib/db/types';
import { requireOrganization } from '@/lib/route/organization';

export type CreateResourceState = { error: string | null; created: boolean };

/**
 * A capability typed by name: the one the business already has under that name, or a new one.
 * Case-insensitive on purpose — the database's own uniqueness is, so "Tire service" typed over
 * "Tire Service" is the same capability and not a refusal.
 */
async function capabilityIdByName(db: Db, organizationId: string, typed: string): Promise<string> {
  const name = typed.trim();
  const existing = (await listResourceCapabilities(db, { organizationId, includeArchived: true })).find(
    (capability) => capability.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    if (existing.archived) {
      throw new DomainError(
        `${existing.name} is archived. Restore it in Resources configuration to use it again.`,
        'resource_capabilities.archived',
      );
    }
    return existing.id;
  }
  return createResourceCapability(db, { organizationId, name });
}

export async function createResourceAction(
  _previous: CreateResourceState,
  formData: FormData,
): Promise<CreateResourceState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  const membershipId = String(formData.get('membershipId') ?? '').trim();
  const resourceClass = String(formData.get('resourceClass') ?? '');

  try {
    if (!isResourceClass(resourceClass)) {
      throw new DomainError('Say what kind of resource this is.', 'resources.class_required');
    }

    const capabilityIds = formData.getAll('capabilityIds').map(String).filter(Boolean);
    const typed = String(formData.get('newCapability') ?? '').trim();
    if (typed.length > 0) capabilityIds.push(await capabilityIdByName(db, organizationId, typed));

    await createResource(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      resourceClass,
      capabilityIds: [...new Set(capabilityIds)],
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

export type ResourceEditState = { error: string | null };

function revalidateResource(organizationId: string, resourceId?: string): void {
  if (resourceId) revalidatePath(`/organizations/${organizationId}/resources/${resourceId}`);
  revalidatePath(`/organizations/${organizationId}/resources`);
}

/** Change what kind of resource this is. Refused by the database while it still represents a member. */
export async function setResourceClassAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  const resourceClass = String(formData.get('resourceClass') ?? '');
  await requireOrganization(organizationId);

  try {
    if (!isResourceClass(resourceClass)) {
      throw new DomainError('Say what kind of resource this is.', 'resources.class_required');
    }
    await setResourceClass(db, { resourceId, resourceClass });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId, resourceId);
  return { error: null };
}

/** Give a resource a capability — an existing one by id, or one typed by name that is created if new. */
export async function assignResourceCapabilityAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  await requireOrganization(organizationId);

  try {
    const typed = String(formData.get('newCapability') ?? '').trim();
    const chosen = String(formData.get('capabilityId') ?? '').trim();
    const capabilityId = typed.length > 0 ? await capabilityIdByName(db, organizationId, typed) : chosen;
    if (!capabilityId) {
      throw new DomainError('Choose a capability, or type a new one.', 'resource_capabilities.required');
    }
    await assignResourceCapability(db, { resourceId, capabilityId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId, resourceId);
  return { error: null };
}

export async function removeResourceCapabilityAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  await requireOrganization(organizationId);

  try {
    await removeResourceCapability(db, {
      resourceId,
      capabilityId: String(formData.get('capabilityId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId, resourceId);
  return { error: null };
}

/** The vocabulary itself — configuration (`field.manage`), enforced by the database. */
export async function createCapabilityAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await createResourceCapability(db, { organizationId, name: String(formData.get('name') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId);
  return { error: null };
}

export async function renameCapabilityAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await renameResourceCapability(db, {
      id: String(formData.get('capabilityId') ?? ''),
      name: String(formData.get('name') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId);
  return { error: null };
}

export async function archiveCapabilityAction(
  _previous: ResourceEditState,
  formData: FormData,
): Promise<ResourceEditState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await setResourceCapabilityArchived(db, {
      id: String(formData.get('capabilityId') ?? ''),
      archived: formData.get('archived') === '1',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateResource(organizationId);
  return { error: null };
}
