import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listResources, type Resource } from '@/lib/domain/resources/resources';
import { isResourceClass, type ResourceClass } from '@/lib/domain/resources/resource-class';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a kind of work needs, and whether a job has it.
 *
 * **A requirement is a minimum need stated once on the type**: a resource class, a quantity, and
 * the capabilities a resource must hold — *all* of them. It is never copied onto a job, and it is
 * not an allowlist: a job may carry more resources than it needs, and may carry fewer than it needs
 * and still be perfectly good stored, scheduled state. Everything below the configuration functions
 * is derived and stored nowhere.
 *
 * **Three different questions, kept apart.** *Eligible* — could this resource play this role
 * (class and capabilities, here). *Assigned* — is it on this job (`work_item_resource_assignments`,
 * unchanged). *Available* — is it free at that time (`freeWindows` and the assignment constraint,
 * untouched, and nothing in this file looks at a clock).
 */
export type ResourceRequirement = {
  id: string;
  typeId: string;
  resourceClass: ResourceClass;
  /** How many resources of this shape. One row for "2 × Person", never two identical rows. */
  quantity: number;
  /** The order the business reads them in, and the order a matching prefers them in. */
  position: number;
  /** Every one of these, by id. An archived one stays visible here for as long as the requirement names it. */
  capabilities: ResourceCapability[];
};

const REQUIREMENT_SELECT =
  'id, type_id, resource_class, quantity, position, capabilities:work_item_type_resource_requirement_capabilities!requirement_capabilities_requirement_same_org (capability:resource_capabilities!requirement_capabilities_capability_same_org (id, name, archived_at))';

type CapabilityRow = { id: string; name: string; archived_at: string | null };
type RequirementRow = {
  id: string;
  type_id: string;
  resource_class: string;
  quantity: number;
  position: number;
  capabilities: { capability: CapabilityRow | CapabilityRow[] | null }[] | null;
};

function toRequirement(row: RequirementRow): ResourceRequirement {
  const capabilities = (row.capabilities ?? [])
    .flatMap((link) => {
      const capability = Array.isArray(link.capability) ? link.capability[0] : link.capability;
      return capability ? [{ id: capability.id, name: capability.name, archived: capability.archived_at !== null }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    id: row.id,
    typeId: row.type_id,
    resourceClass: (isResourceClass(row.resource_class) ? row.resource_class : 'other') as ResourceClass,
    quantity: row.quantity,
    position: row.position,
    capabilities,
  };
}

/** One query for every type's requirements — or one type's — in the business's own reading order. */
export async function listResourceRequirements(
  db: Db,
  input: { organizationId: string; typeId?: string },
): Promise<ResourceRequirement[]> {
  let query = db
    .from('work_item_type_resource_requirements')
    .select(REQUIREMENT_SELECT)
    .eq('organization_id', input.organizationId)
    .order('position', { ascending: true })
    .order('id', { ascending: true });
  if (input.typeId) query = query.eq('type_id', input.typeId);

  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'resource_requirements.list_failed');

  return (data ?? []).map((row) => toRequirement(row as unknown as RequirementRow));
}

type RequirementInput = {
  resourceClass: ResourceClass;
  quantity: number;
  capabilityIds: string[];
};

function checked(input: RequirementInput): void {
  if (!isResourceClass(input.resourceClass)) {
    throw new DomainError('Say what kind of resource is needed.', 'resource_requirements.class_required');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) {
    throw new DomainError('The number needed is a whole number from 1 to 50.', 'resource_requirements.quantity_invalid');
  }
}

/** The database's refusals, as sentences. Nothing is deleted or unpublished on the caller's behalf. */
function failure(error: { code?: string; message: string }): DomainError {
  if (error.code === 'GD008') {
    return new DomainError(
      'This work is not scheduled, so it cannot need resources. Turn scheduling on for it first.',
      'resource_requirements.not_schedulable',
    );
  }
  if (error.code === 'GD011') {
    return new DomainError(
      'Public booking currently supports one required resource. Remove the additional resource requirements or turn public booking off.',
      'resource_requirements.booking_incompatible',
    );
  }
  if (error.code === 'GD007') {
    return new DomainError('That capability is archived and cannot be newly required.', 'resource_requirements.capability_archived');
  }
  if (error.code === '23503') {
    return new DomainError('No such capability here.', 'resource_requirements.capability_not_found');
  }
  if (error.code === '23505') {
    return new DomainError('That capability is already required here.', 'resource_requirements.capability_duplicate');
  }
  if (error.code === '23514') {
    return new DomainError('The number needed is a whole number from 1 to 50.', 'resource_requirements.quantity_invalid');
  }
  if (error.code === '42501') {
    return new DomainError('You cannot configure what this work needs.', 'resource_requirements.forbidden');
  }
  return new DomainError(error.message, 'resource_requirements.failed');
}

export async function createResourceRequirement(
  db: Db,
  input: RequirementInput & { typeId: string },
): Promise<string> {
  await requireActor(db);
  checked(input);

  const { data, error } = await db.rpc('create_resource_requirement', {
    p_type_id: input.typeId,
    p_resource_class: input.resourceClass,
    p_quantity: input.quantity,
    p_capability_ids: input.capabilityIds,
  });
  if (error) throw failure(error);
  return data;
}

/** Class, quantity and capabilities change together, in one transaction — never a window where the three disagree. */
export async function updateResourceRequirement(
  db: Db,
  input: RequirementInput & { id: string },
): Promise<void> {
  await requireActor(db);
  checked(input);

  const { error } = await db.rpc('update_resource_requirement', {
    p_id: input.id,
    p_resource_class: input.resourceClass,
    p_quantity: input.quantity,
    p_capability_ids: input.capabilityIds,
  });
  if (error) throw failure(error);
}

export async function deleteResourceRequirement(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);
  const { error } = await db.rpc('delete_resource_requirement', { p_id: input.id });
  if (error) throw failure(error);
}

// ---------------------------------------------------------------------------
// Eligibility — the one definition
// ---------------------------------------------------------------------------

/** The class matches and the resource holds every capability named. No capabilities named: class alone. */
export function isEligible(
  resource: Pick<Resource, 'resourceClass' | 'capabilities'>,
  requirement: Pick<ResourceRequirement, 'resourceClass' | 'capabilities'>,
): boolean {
  if (resource.resourceClass !== requirement.resourceClass) return false;
  const held = new Set(resource.capabilities.map((capability) => capability.id));
  return requirement.capabilities.every((capability) => held.has(capability.id));
}

/**
 * Every resource that could play this role, by name. Reads through `listResources`'s class and
 * capability filters — the one place those are answered — and is eligibility only: nothing here
 * asks whether anyone is free.
 */
export async function listEligibleResources(
  db: Db,
  input: { organizationId: string; resourceClass: ResourceClass; capabilityIds?: string[] },
): Promise<Resource[]> {
  const found = await listResources(db, {
    organizationId: input.organizationId,
    resourceClass: input.resourceClass,
    capabilityIds: input.capabilityIds,
    limit: 1000,
  });
  return [...found].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function listEligibleResourcesForRequirement(
  db: Db,
  input: { organizationId: string; requirement: Pick<ResourceRequirement, 'resourceClass' | 'capabilities'> },
): Promise<Resource[]> {
  return listEligibleResources(db, {
    organizationId: input.organizationId,
    resourceClass: input.requirement.resourceClass,
    capabilityIds: input.requirement.capabilities.map((capability) => capability.id),
  });
}

// ---------------------------------------------------------------------------
// Coverage — derived, never stored
// ---------------------------------------------------------------------------

export type RequirementCoverage = {
  requirement: ResourceRequirement;
  requiredQuantity: number;
  /** The assigned resources standing in for this requirement's slots. */
  matchedResources: Resource[];
  missingQuantity: number;
  satisfied: boolean;
};

export type RequirementEvaluation = {
  requirements: RequirementCoverage[];
  /** Every requirement satisfied. A type with none is trivially satisfied. */
  satisfied: boolean;
  /** Required slots still empty, across all requirements. */
  missingQuantity: number;
  /** Assigned resources no slot needed. Valid — requirements are minimums, not an allowlist. */
  unmatchedAssignedResources: Resource[];
};

type Slot = { requirement: ResourceRequirement; index: number };

/**
 * Which of a job's assigned resources cover which required slots.
 *
 * **A resource is one unit of capacity: it can fill one slot and not two.** Counting "how many
 * assigned are eligible" per requirement independently would let one person who is both a tire
 * technician and an oil-change technician satisfy two required positions, and would make the
 * answer depend on nothing the business meant. So each requirement is expanded into its slots and
 * the slots are matched to the assigned resources as a bipartite matching (augmenting paths), which
 * finds the *largest* possible coverage — a greedy first-come match can spend the one resource that
 * can fill a hard slot on an easy one and report a gap that a better arrangement would not have.
 *
 * **Deterministic**: slots in requirement `position` then `id` order, resources by name then id, so
 * the same inputs give the same answer on every render. It reads no clock and asks nothing of the
 * database; it is not routing, and not availability.
 */
export function evaluateRequirements(
  requirements: readonly ResourceRequirement[],
  assigned: readonly Resource[],
): RequirementEvaluation {
  const orderedRequirements = [...requirements].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const resources = [...assigned].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const slots: Slot[] = orderedRequirements.flatMap((requirement) =>
    Array.from({ length: requirement.quantity }, (_, index) => ({ requirement, index })),
  );

  // resource index -> slot index, and the reverse, for the augmenting search.
  const slotOf = new Map<number, number>();
  const resourceOf = new Map<number, number>();

  const eligible = (slot: Slot) =>
    resources.flatMap((resource, index) => (isEligible(resource, slot.requirement) ? [index] : []));

  function augment(slotIndex: number, seen: Set<number>): boolean {
    for (const resourceIndex of eligible(slots[slotIndex])) {
      if (seen.has(resourceIndex)) continue;
      seen.add(resourceIndex);

      const holder = slotOf.get(resourceIndex);
      if (holder === undefined || augment(holder, seen)) {
        slotOf.set(resourceIndex, slotIndex);
        resourceOf.set(slotIndex, resourceIndex);
        return true;
      }
    }
    return false;
  }

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    augment(slotIndex, new Set());
  }

  const coverage: RequirementCoverage[] = orderedRequirements.map((requirement) => {
    const matched: Resource[] = [];
    slots.forEach((slot, slotIndex) => {
      if (slot.requirement.id !== requirement.id) return;
      const resourceIndex = resourceOf.get(slotIndex);
      if (resourceIndex !== undefined) matched.push(resources[resourceIndex]);
    });
    const missingQuantity = requirement.quantity - matched.length;
    return {
      requirement,
      requiredQuantity: requirement.quantity,
      matchedResources: matched,
      missingQuantity,
      satisfied: missingQuantity === 0,
    };
  });

  const used = new Set(slotOf.keys());
  return {
    requirements: coverage,
    satisfied: coverage.every((entry) => entry.satisfied),
    missingQuantity: coverage.reduce((sum, entry) => sum + entry.missingQuantity, 0),
    unmatchedAssignedResources: resources.filter((_, index) => !used.has(index)),
  };
}

/**
 * Coverage for many jobs at once: the types' requirements in one query and the business's resources
 * in another, however many jobs there are. Jobs of a type that needs nothing are left out of the
 * result, so a caller's absence check is also its "nothing to say" check.
 */
export async function evaluateWorkItems(
  db: Db,
  input: {
    organizationId: string;
    items: readonly { workItemId: string; typeId: string; resourceIds: readonly string[] }[];
  },
): Promise<Map<string, RequirementEvaluation>> {
  const result = new Map<string, RequirementEvaluation>();
  if (input.items.length === 0) return result;

  const requirements = await listResourceRequirements(db, { organizationId: input.organizationId });
  if (requirements.length === 0) return result;

  const byType = new Map<string, ResourceRequirement[]>();
  for (const requirement of requirements) {
    byType.set(requirement.typeId, [...(byType.get(requirement.typeId) ?? []), requirement]);
  }

  const resources = await listResources(db, { organizationId: input.organizationId, limit: 1000 });
  const byId = new Map(resources.map((resource) => [resource.id, resource]));

  for (const item of input.items) {
    const needs = byType.get(item.typeId);
    if (!needs) continue;
    const assigned = item.resourceIds.flatMap((id) => byId.get(id) ?? []);
    result.set(item.workItemId, evaluateRequirements(needs, assigned));
  }

  return result;
}

/** One line for a job that is short: "Vehicle missing", "2 resources missing". Words, not a colour. */
export function describeShortfall(evaluation: RequirementEvaluation, labels: Record<ResourceClass, string>): string | null {
  if (evaluation.satisfied) return null;
  const short = evaluation.requirements.filter((entry) => !entry.satisfied);
  if (short.length === 1) {
    const [only] = short;
    return `${labels[only.requirement.resourceClass]} missing${only.missingQuantity > 1 ? ` (${only.missingQuantity})` : ''}`;
  }
  return `${evaluation.missingQuantity} resources missing`;
}

// ---------------------------------------------------------------------------
// Views for the screens — plain data, derived from the same functions above
// ---------------------------------------------------------------------------

/** "Person · Tire service": a requirement in the business's own words. */
export function requirementTitle(
  requirement: Pick<ResourceRequirement, 'resourceClass' | 'capabilities'>,
  labels: Record<ResourceClass, string>,
): string {
  const names = requirement.capabilities.map((capability) => capability.name);
  return names.length > 0 ? `${labels[requirement.resourceClass]} · ${names.join(', ')}` : labels[requirement.resourceClass];
}

export type RequirementGroupView = {
  requirementId: string;
  title: string;
  quantity: number;
  /** Resources that could fill this role, each listed once — under the first requirement it is eligible for. */
  resourceIds: string[];
};

export type ResourceNeedsView = {
  groups: RequirementGroupView[];
  /** Everything else that may still be assigned: resources no requirement asks for. */
  additionalIds: string[];
};

/**
 * The picker's grouping: which resources are eligible for each requirement. A resource is shown once,
 * under the first requirement (in reading order) it could fill, so a ticked box is never two boxes —
 * the grouping is a suggestion for the eye, the assignment stays an ordinary set of resources, and
 * whether it actually covers the needs is `evaluateRequirements`' answer, not this layout's.
 */
export function requirementGroups(
  requirements: readonly ResourceRequirement[],
  resources: readonly Resource[],
  labels: Record<ResourceClass, string>,
): ResourceNeedsView {
  const ordered = [...requirements].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const sorted = [...resources].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const placed = new Set<string>();

  const groups = ordered.map((requirement) => {
    const resourceIds = sorted
      .filter((resource) => !placed.has(resource.id) && isEligible(resource, requirement))
      .map((resource) => resource.id);
    resourceIds.forEach((id) => placed.add(id));
    return { requirementId: requirement.id, title: requirementTitle(requirement, labels), quantity: requirement.quantity, resourceIds };
  });

  return { groups, additionalIds: sorted.filter((resource) => !placed.has(resource.id)).map((resource) => resource.id) };
}

export type CoverageView = {
  satisfied: boolean;
  missingQuantity: number;
  /** One line per requirement, in words that do not lean on colour: "Person · Tire service — Alex" / "Vehicle — missing 1". */
  lines: { requirementId: string; text: string; met: boolean }[];
  extra: string[];
  /** The short form for a list or a calendar entry, or null when nothing is missing. */
  shortfall: string | null;
};

export function coverageView(evaluation: RequirementEvaluation, labels: Record<ResourceClass, string>): CoverageView {
  return {
    satisfied: evaluation.satisfied,
    missingQuantity: evaluation.missingQuantity,
    lines: evaluation.requirements.map((entry) => {
      const title = `${entry.requiredQuantity > 1 ? `${entry.requiredQuantity} × ` : ''}${requirementTitle(entry.requirement, labels)}`;
      const names = entry.matchedResources.map((resource) => resource.name).join(', ');
      return {
        requirementId: entry.requirement.id,
        met: entry.satisfied,
        text: entry.satisfied
          ? `${title} — ${names}`
          : `${title} — missing ${entry.missingQuantity}${names ? ` (have ${names})` : ''}`,
      };
    }),
    extra: evaluation.unmatchedAssignedResources.map((resource) => resource.name),
    shortfall: describeShortfall(evaluation, labels),
  };
}
