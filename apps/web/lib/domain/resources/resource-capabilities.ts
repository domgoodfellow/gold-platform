import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business says a resource can do, in its own words — "Tire service", "Mobile service".
 *
 * **One term, deliberately.** Not a skill, a qualification or a tag: a tag says *preferred* or
 * *east*, and this says *eligible to satisfy a declared requirement*. The scheduling engine will
 * ask one question — can this resource satisfy that? — and this is the whole of the answer it will
 * read. Identity is the id: renaming changes no assignment, and a capability is archived rather
 * than deleted so anything that later points at it keeps its meaning.
 */
export type ResourceCapability = {
  id: string;
  name: string;
  archived: boolean;
};

const NAME_MAX = 64;

function checkedName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('A capability needs a name.', 'resource_capabilities.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'resource_capabilities.name_too_long',
    );
  }
  return name;
}

/** The vocabulary, by name. Archived ones only when asked — a picker offers what can still be given. */
export async function listResourceCapabilities(
  db: Db,
  input: { organizationId: string; includeArchived?: boolean },
): Promise<ResourceCapability[]> {
  let query = db
    .from('resource_capabilities')
    .select('id, name, archived_at')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });
  if (!input.includeArchived) query = query.is('archived_at', null);

  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'resource_capabilities.list_failed');

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, archived: row.archived_at !== null }));
}

export async function createResourceCapability(
  db: Db,
  input: { organizationId: string; name: string },
): Promise<string> {
  await requireActor(db);
  const name = checkedName(input.name);

  const { data, error } = await db.rpc('create_resource_capability', {
    p_organization_id: input.organizationId,
    p_name: name,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `A capability called ${name} already exists here.`,
        'resource_capabilities.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure capabilities here.', 'resource_capabilities.forbidden');
    }
    throw new DomainError(error.message, 'resource_capabilities.create_failed');
  }

  return data;
}

export async function renameResourceCapability(
  db: Db,
  input: { id: string; name: string },
): Promise<void> {
  await requireActor(db);
  const name = checkedName(input.name);

  const { error } = await db.rpc('rename_resource_capability', { p_id: input.id, p_name: name });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `A capability called ${name} already exists here.`,
        'resource_capabilities.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure capabilities here.', 'resource_capabilities.forbidden');
    }
    throw new DomainError(error.message, 'resource_capabilities.rename_failed');
  }
}

/** Archive or restore. Resources that hold an archived capability keep it; it just cannot be given again. */
export async function setResourceCapabilityArchived(
  db: Db,
  input: { id: string; archived: boolean },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('set_resource_capability_archived', {
    p_id: input.id,
    p_archived: input.archived,
  });

  if (error) {
    // `app.check_capability_not_required`: what a kind of work needs must not change meaning unnoticed.
    if (error.code === 'GD010') {
      const { data } = await db.from('resource_capabilities').select('name').eq('id', input.id).maybeSingle();
      throw new DomainError(
        `${data?.name ?? 'This capability'} is required by one or more work types. Remove it from those requirements before archiving it.`,
        'resource_capabilities.required',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot configure capabilities here.', 'resource_capabilities.forbidden');
    }
    throw new DomainError(error.message, 'resource_capabilities.archive_failed');
  }
}

function assignmentError(error: { code?: string; message: string }): DomainError {
  if (error.code === '23505') {
    return new DomainError('That resource already has that capability.', 'resource_capabilities.already_assigned');
  }
  if (error.code === 'GD007') {
    return new DomainError('That capability is archived and cannot be given to anything new.', 'resource_capabilities.archived');
  }
  // The composite reference refusing a capability that is not this business's.
  if (error.code === '23503') {
    return new DomainError('No such capability here.', 'resource_capabilities.not_found');
  }
  if (error.code === '42501') {
    return new DomainError('No such resource, or you cannot change it.', 'resource_capabilities.assign_forbidden');
  }
  return new DomainError(error.message, 'resource_capabilities.assign_failed');
}

export async function assignResourceCapability(
  db: Db,
  input: { resourceId: string; capabilityId: string },
): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('assign_resource_capability', {
    p_resource_id: input.resourceId,
    p_capability_id: input.capabilityId,
  });
  if (error) throw assignmentError(error);
}

export async function removeResourceCapability(
  db: Db,
  input: { resourceId: string; capabilityId: string },
): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('remove_resource_capability', {
    p_resource_id: input.resourceId,
    p_capability_id: input.capabilityId,
  });
  if (error) throw assignmentError(error);
}
