import { memberDisplayNames } from '@/lib/domain/tenancy/members';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { isResourceClass, type ResourceClass } from '@/lib/domain/resources/resource-class';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { isTravelMode, type TravelMode } from '@/lib/domain/resources/travel-mode';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type Resource = {
  id: string;
  name: string;
  /** What kind of schedulable thing this is — platform vocabulary, stated, never inferred from the name. */
  resourceClass: ResourceClass;
  /** What the business says this resource can do, by name. Archived ones stay on the resource that holds them. */
  capabilities: ResourceCapability[];
  /** Tenant-defined fields, governed by this organization's registry. Nothing the scheduling engine reads lives here. */
  custom: CustomValues;
  createdAt: string;
  /**
   * How this resource moves, as the business says it — or null, which is *not said*, and means
   * travel is not evaluated for it. Never inferred from `resourceClass`.
   */
  travelMode: TravelMode | null;
  /** A routing fallback (and a fixed resource's place): a canonical Location. Not a live position. */
  baseLocationId: string | null;
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
  'id, name, resource_class, travel_mode, base_location_id, custom, created_at, membership_id, member:memberships!resources_membership_same_org(id, display_name), assignments:resource_capability_assignments!resource_capability_assignments_resource_same_org(capability:resource_capabilities!resource_capability_assignments_capability_same_org(id, name, archived_at))';

type CapabilityRow = { id: string; name: string; archived_at: string | null };

type ResourceRow = {
  id: string;
  name: string;
  resource_class: string;
  travel_mode: string | null;
  base_location_id: string | null;
  assignments: { capability: CapabilityRow | CapabilityRow[] | null }[] | null;
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
  const capabilities = (row.assignments ?? []).flatMap((assignment) => {
    const capability = one(assignment.capability);
    return capability ? [{ id: capability.id, name: capability.name, archived: capability.archived_at !== null }] : [];
  });
  capabilities.sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: row.id,
    name: row.name,
    // The column is a checked closed set, so this narrows rather than guards.
    resourceClass: (isResourceClass(row.resource_class) ? row.resource_class : 'other') as ResourceClass,
    capabilities,
    custom: (row.custom ?? {}) as CustomValues,
    createdAt: row.created_at,
    travelMode: isTravelMode(row.travel_mode) ? row.travel_mode : null,
    baseLocationId: row.base_location_id,
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
  input: {
    organizationId: string;
    limit?: number;
    offset?: number;
    /** Resolve only canonical identities already assigned to the jobs being evaluated. */
    ids?: readonly string[];
    /** Only resources of this class. */
    resourceClass?: ResourceClass;
    /** Only resources that hold this capability. Eligibility, not availability — nothing here looks at time. */
    capabilityId?: string;
    /** Only resources that hold **every** one of these. The shape a work requirement asks in. */
    capabilityIds?: string[];
  },
): Promise<Counted<Resource>> {
  let query = db
    .from('resources')
    .select(RESOURCE_SELECT, { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(Math.max(0, input.offset ?? 0), Math.max(0, input.offset ?? 0) + Math.max(1, input.limit ?? LIST_LIMIT) - 1);

  if (input.ids) query = query.in('id', [...input.ids]);
  if (input.resourceClass) query = query.eq('resource_class', input.resourceClass);

  const wanted = [...new Set([...(input.capabilityIds ?? []), ...(input.capabilityId ? [input.capabilityId] : [])])];
  if (wanted.length > 0) {
    // Two steps rather than an inner join: filtering the embedded assignments would also trim the
    // capabilities each resource is shown with, and a resource must list everything it can do.
    // All of them, never any of them — a resource qualifies only when it holds each one asked for.
    const { data: holders, error: holdersError } = await db
      .from('resource_capability_assignments')
      .select('resource_id, capability_id')
      .eq('organization_id', input.organizationId)
      .in('capability_id', wanted);
    if (holdersError) {
      throw fromDatabaseError(holdersError, 'resources.list_failed');
    }
    const held = new Map<string, Set<string>>();
    for (const holder of holders ?? []) {
      held.set(holder.resource_id, (held.get(holder.resource_id) ?? new Set()).add(holder.capability_id));
    }
    query = query.in(
      'id',
      [...held.entries()].filter(([, ids]) => ids.size === wanted.length).map(([resourceId]) => resourceId),
    );
  }

  const { data, error, count } = await query;

  if (error) {
    throw fromDatabaseError(error, 'resources.list_failed');
  }

  const names = await memberDisplayNames(db, input.organizationId);
  return counted((data ?? []).map((row) => {
    const resource = toResource(row as ResourceRow);
    if (resource.member) resource.member.displayName = names.get(resource.member.membershipId) ?? resource.member.displayName;
    return resource;
  }), count);
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
    throw fromDatabaseError(error, 'resources.get_failed');
  }
  if (!data) return null;

  const resource = toResource(data as ResourceRow);
  if (resource.member) {
    const names = await memberDisplayNames(db, input.organizationId);
    resource.member.displayName = names.get(resource.member.membershipId) ?? resource.member.displayName;
  }
  return resource;
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
    /** Stated every time. There is no default: the platform does not decide what a business's resource is. */
    resourceClass: ResourceClass;
    /** Capabilities given at creation, in the same transaction. Archived ones are refused. */
    capabilityIds?: string[];
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

  if (!isResourceClass(input.resourceClass)) {
    throw new DomainError('Say what kind of resource this is.', 'resources.class_required');
  }
  if (input.membershipId && input.resourceClass !== 'person') {
    throw new DomainError(
      'Only a person can represent a member.',
      'resources.member_requires_person',
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
    p_resource_class: input.resourceClass,
    p_custom: custom,
    ...(input.membershipId ? { p_membership_id: input.membershipId } : {}),
    ...(input.capabilityIds && input.capabilityIds.length > 0 ? { p_capability_ids: input.capabilityIds } : {}),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot add resources here.', 'resources.forbidden');
    }
    if (error.code === '23514') {
      if (error.message.includes('resources_member_is_person')) {
        throw new DomainError('Only a person can represent a member.', 'resources.member_requires_person');
      }
      throw fromDatabaseError(error, 'resources.custom_invalid');
    }
    // An archived capability given at creation.
    if (error.code === 'GD007') {
      throw new DomainError('That skill is archived, so it can’t be given to anything new.', 'resource_capabilities.archived');
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
    throw fromDatabaseError(error, 'resources.create_failed');
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
    // Null by design, not by omission — see the parameter above. The cast is the forward-only migration rule's: Postgres
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
    // `resources_member_is_person`: a vehicle, a room or a machine cannot stand for a member.
    if (error.code === '23514') {
      throw new DomainError('Only a person can represent a member.', 'resources.member_requires_person');
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
    throw fromDatabaseError(error, 'resources.update_failed');
  }
}

/**
 * Change what kind of resource this is.
 *
 * Refused by the database while the resource represents a member and the new class is not person
 * (`resources_member_is_person`) — nothing is unlinked on the caller's behalf, so a person who is
 * a member becomes a vehicle only after somebody has deliberately cleared the link.
 */
export async function setResourceClass(
  db: Db,
  input: { resourceId: string; resourceClass: ResourceClass },
): Promise<void> {
  await requireActor(db);

  if (!isResourceClass(input.resourceClass)) {
    throw new DomainError('Say what kind of resource this is.', 'resources.class_required');
  }

  const { error } = await db.rpc('set_resource_class', {
    p_resource_id: input.resourceId,
    p_resource_class: input.resourceClass,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('No such resource, or you cannot change it.', 'resources.update_forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError(
        'This resource represents a member, so it can only be a person. Clear the member first.',
        'resources.member_requires_person',
      );
    }
    throw fromDatabaseError(error, 'resources.update_failed');
  }
}

/**
 * Say how a resource moves and where it starts from. Both optional and independent: a mobile
 * resource with no base is valid (its origin is then unknown when it has no earlier job), and a
 * fixed one needs a base to be able to take any work at all — the engine says so rather than this
 * refusing, because a base may be added a moment later in the same sitting.
 *
 * The composite key refuses a Location of another business; RLS and the column grant decide who may.
 */
export async function setResourceRouting(
  db: Db,
  input: { resourceId: string; travelMode: TravelMode | null; baseLocationId: string | null },
): Promise<void> {
  await requireActor(db);

  if (input.travelMode !== null && !isTravelMode(input.travelMode)) {
    throw new DomainError('Say whether this resource is mobile or fixed.', 'resources.travel_mode_invalid');
  }

  const { error } = await db.rpc('set_resource_routing', {
    p_resource_id: input.resourceId,
    p_travel_mode: input.travelMode as string,
    p_base_location_id: input.baseLocationId as string,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('No such resource, or you cannot change it.', 'resources.update_forbidden');
    }
    if (error.code === '23503') {
      throw new DomainError("That place is not one of this business's locations.", 'resources.base_location_invalid');
    }
    throw fromDatabaseError(error, 'resources.update_failed');
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
    throw fromDatabaseError(membershipError, 'resources.current_member_failed');
  }
  if (!membership) return null;

  const { data, error } = await db
    .from('resources')
    .select(RESOURCE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('membership_id', membership.id)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'resources.current_member_failed');
  }
  if (!data) return null;

  const resource = toResource(data as ResourceRow);
  if (resource.member) {
    const names = await memberDisplayNames(db, input.organizationId);
    resource.member.displayName = names.get(resource.member.membershipId) ?? resource.member.displayName;
  }
  return resource;
}
