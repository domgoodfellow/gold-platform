import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type Resource = {
  id: string;
  name: string;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
  /**
   * The tenant Membership this Resource represents, or null. Null is the ordinary case — a
   * vehicle, a room, a machine, or a person with no GildOps account — not an unset field
   * waiting to be filled in (Slice 0B). `displayName` is the tenant's own word for that person
   * (`memberships.display_name`), never a global profile; this is a projection of that Member,
   * not a copy of anything from `auth.users`.
   */
  member: { membershipId: string; displayName: string } | null;
};

const NAME_MAX = 200;

// One string literal for the same reason `MEMBER_SELECT` in `tenancy/members.ts` is — supabase-js
// parses a select at the type level, so this only resolves through `resources_membership_same_org`
// when written as one literal rather than assembled.
const RESOURCE_SELECT =
  'id, name, custom, created_at, membership_id, member:memberships!resources_membership_same_org(id, display_name)';

type ResourceRow = {
  id: string;
  name: string;
  custom: unknown;
  created_at: string;
  membership_id: string | null;
  member: { id: string; display_name: string } | { id: string; display_name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function toResource(row: ResourceRow): Resource {
  const member = one(row.member);
  return {
    id: row.id,
    name: row.name,
    custom: (row.custom ?? {}) as CustomValues,
    createdAt: row.created_at,
    member: member ? { membershipId: member.id, displayName: member.display_name } : null,
  };
}

/**
 * The resources one organization can schedule against.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted the rows to organizations the caller belongs to.
 */
export async function listResources(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<Resource>> {
  const { data, error, count } = await db
    .from('resources')
    .select(RESOURCE_SELECT, { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'resources.list_failed');
  }

  return counted((data ?? []).map((row) => toResource(row as ResourceRow)), count);
}

/**
 * One resource, or null.
 *
 * Null covers both "no such resource" and "not yours" indistinguishably, via RLS — the same
 * shape `getCustomer`, `getAsset` and `getLocation` share.
 */
export async function getResource(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<Resource | null> {
  const { data, error } = await db
    .from('resources')
    .select(RESOURCE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('id', input.resourceId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'resources.get_failed');
  }
  if (!data) return null;

  return toResource(data as ResourceRow);
}

/**
 * Record something the business can schedule work against.
 *
 * Whether the caller may is not decided here — `resources_insert` requires `resource.create`,
 * so a caller without it is refused by the database however it arrives.
 */
export async function createResource(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
    /**
     * An existing organization Membership this Resource represents, chosen at the moment of
     * creation — the same authority (`resource.create`) that sets every other field on the row
     * being created, not `resource.update`, which exists for correcting one that already
     * exists.
     */
    membershipId?: string | null;
  },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A resource needs a name.', 'resources.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'resources.name_too_long',
    );
  }

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'resource',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_resource', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_custom: custom,
    ...(input.membershipId ? { p_membership_id: input.membershipId } : {}),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot add resources here.', 'resources.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'resources.custom_invalid');
    }
    // The composite reference refusing a Membership that is not in this tenant.
    if (error.code === '23503') {
      throw new DomainError('No such member here.', 'resources.member_not_found');
    }
    // The partial unique index: that Membership already represents another Resource.
    if (error.code === '23505') {
      throw new DomainError(
        'That member already represents another resource.',
        'resources.member_already_linked',
      );
    }
    throw new DomainError(error.message, 'resources.create_failed');
  }

  return data;
}

/**
 * Link, change or clear the Membership a Resource represents.
 *
 * Whether the caller may is not decided here — `resources_update` requires `resource.update`,
 * so a caller without it is refused by the database however it arrives. Null clears the link;
 * it is not distinguished from setting one, since both are the same authority over the same
 * column.
 */
export async function setResourceMembership(
  db: Db,
  input: { resourceId: string; membershipId: string | null },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('set_resource_membership', {
    p_resource_id: input.resourceId,
    // Null by design, not by omission — see the parameter above. The cast is D15's: Postgres
    // records no nullability for a function argument (the same shape `scheduleWorkItem` casts).
    p_membership_id: input.membershipId as string,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'No such resource, or you cannot change it.',
        'resources.update_forbidden',
      );
    }
    // The composite reference refusing a Membership that is not in this tenant.
    if (error.code === '23503') {
      throw new DomainError('No such member here.', 'resources.member_not_found');
    }
    // The partial unique index: that Membership already represents another Resource.
    if (error.code === '23505') {
      throw new DomainError(
        'That member already represents another resource.',
        'resources.member_already_linked',
      );
    }
    throw new DomainError(error.message, 'resources.update_failed');
  }
}

/**
 * The Resource that represents the current caller in this organization, or null.
 *
 * The prerequisite Slice 0C needs and nothing more: resolved through the caller's own auth
 * identity → their Membership in this organization → the Resource that names it, and nothing
 * else. **Not applied to Schedule visibility in this slice** — see
 * `schedule-visibility-heuristic.test.ts` and docs/domain-model.md. Deliberately does not
 * infer anything from a display name, a resource's own name, a role, a preset or `created_by`
 * — those are exactly the heuristics this resolver exists to make unnecessary.
 */
export async function getResourceForCurrentMember(
  db: Db,
  input: { organizationId: string },
): Promise<Resource | null> {
  const actor = await requireActor(db);

  const { data: membership, error: membershipError } = await db
    .from('memberships')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', actor.id)
    .maybeSingle();

  if (membershipError) {
    throw new DomainError(membershipError.message, 'resources.current_member_failed');
  }
  if (!membership) return null;

  const { data, error } = await db
    .from('resources')
    .select(RESOURCE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('membership_id', membership.id)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'resources.current_member_failed');
  }
  if (!data) return null;

  return toResource(data as ResourceRow);
}
