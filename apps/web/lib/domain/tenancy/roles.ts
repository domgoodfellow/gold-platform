import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { isCapability, type Capability } from './capabilities';

export type Role = {
  id: string;
  name: string;
  capabilities: Capability[];
  createdAt: string;
};

const NAME_MAX = 64;

export async function listRoles(
  db: Db,
  input: { organizationId: string },
): Promise<Role[]> {
  const { data, error } = await db
    .from('roles')
    .select('id, name, capabilities, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'roles.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    capabilities: row.capabilities.filter(isCapability),
    createdAt: row.created_at,
  }));
}

/**
 * Create a role.
 *
 * Whether the caller is *allowed* to is not decided here — `roles_insert` requires
 * `role.manage`, so a caller without it is refused by the database whether it arrives
 * through this function, a raw RPC, or an AI tool. What this owns is what a well-formed
 * role looks like.
 */
export async function createRole(
  db: Db,
  input: { organizationId: string; name: string; capabilities: string[] },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A role needs a name.', 'roles.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'roles.name_too_long',
    );
  }

  // Reject unknown capabilities here rather than letting the check constraint do it, so the
  // message names the offender instead of quoting a constraint.
  const unknown = input.capabilities.filter((capability) => !isCapability(capability));
  if (unknown.length > 0) {
    throw new DomainError(
      `Not a capability: ${unknown.join(', ')}.`,
      'roles.capability_unknown',
    );
  }

  const capabilities = [...new Set(input.capabilities)];

  const { data, error } = await db.rpc('create_role', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_capabilities: capabilities,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('A role with that name already exists here.', 'roles.name_taken');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage roles here.', 'roles.forbidden');
    }
    throw new DomainError(error.message, 'roles.create_failed');
  }

  return data;
}

/**
 * Point a membership at a different role.
 *
 * The rule that an organization must keep someone who can manage roles is enforced in
 * `public.assign_role`, not here. It spans rows, so only the database can see it atomically
 * — and a guard that lives only in this file is a guard a direct RPC call walks past.
 */
export async function assignRole(
  db: Db,
  input: { membershipId: string; roleId: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('assign_role', {
    p_membership_id: input.membershipId,
    p_role_id: input.roleId,
  });

  if (error) {
    if (error.code === '23514') {
      throw new DomainError(
        'That would leave nobody able to manage roles here.',
        'roles.last_manager',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage roles here.', 'roles.forbidden');
    }
    throw new DomainError(error.message, 'roles.assign_failed');
  }
}
