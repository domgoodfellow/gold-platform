import type {
  AssignedResourceCheck,
  FeasibilityReason,
  FeasibilityResult,
} from '@/lib/domain/scheduling/feasibility';

/**
 * Words for the domain's structured reasons — and only here. `feasibility.ts` returns codes and
 * numbers; a screen turns them into sentences, so the contract never stores English and a later
 * language or a shorter phrasing changes this file and nothing that decides anything.
 */
export type FeasibilityNames = {
  /** "Alex", "Service Van 1" — a resource's own name. */
  resource: (id: string) => string;
  /** "Vehicle · Mobile service" — a requirement as the business reads it. */
  requirement: (id: string | null) => string;
};

export function describeReason(reason: FeasibilityReason, names: FeasibilityNames): string {
  switch (reason.code) {
    case 'outside_organization_hours':
      return 'The business is closed then.';
    case 'no_eligible_resource':
      return `No ${names.requirement(reason.requirementId)} exists that could do this.`;
    case 'insufficient_eligible_resources':
      return `${names.requirement(reason.requirementId)}: ${reason.required} needed, but only ${reason.eligible} could do this.`;
    case 'resource_not_working':
      return `${names.resource(reason.resourceId)} is not working then.`;
    case 'resource_unavailable':
      return `${names.resource(reason.resourceId)} is unavailable then.`;
    case 'resource_already_committed':
      return `${names.resource(reason.resourceId)} is already booked then.`;
    case 'insufficient_free_resources':
      return `${names.requirement(reason.requirementId)}: ${reason.required} needed, ${reason.free} free (${reason.eligible} could do this).`;
    case 'requirements_compete_for_same_resources':
      return `These needs compete for the same people: ${reason.requirementIds.map((id) => names.requirement(id)).join('; ')}.`;
  }
}

export type FeasibilityView = {
  feasible: boolean;
  /** The one-line verdict, in words — never colour alone. */
  summary: string;
  /** Names of the suggested combination, in requirement order. Empty when infeasible or when nothing is needed. */
  suggestedIds: string[];
  suggestedNames: string[];
  /** Why it does not work, outermost cause first. */
  reasons: string[];
  /** About the exact resources ticked, when any were. */
  selection: { ok: boolean; lines: string[] } | null;
};

export function viewFeasibility(
  result: FeasibilityResult,
  selection: AssignedResourceCheck | null,
  names: FeasibilityNames,
): FeasibilityView {
  const suggestedIds = (result.combination ?? []).map((entry) => entry.resourceId);

  let selectionView: FeasibilityView['selection'] = null;
  if (selection) {
    const lines: string[] = [];
    for (const entry of selection.resources) {
      if (entry.problem === 'not_working') lines.push(`${names.resource(entry.resourceId)} is not working then.`);
      else if (entry.problem === 'unavailable') lines.push(`${names.resource(entry.resourceId)} is unavailable then.`);
      else if (entry.problem === 'committed') lines.push(`${names.resource(entry.resourceId)} is already booked then.`);
    }
    for (const requirement of selection.requirements) {
      if (!requirement.satisfied) {
        lines.push(`${names.requirement(requirement.requirementId)} requirement missing${requirement.missingQuantity > 1 ? ` (${requirement.missingQuantity})` : ''}.`);
      }
    }
    selectionView = { ok: selection.ok, lines };
  }

  return {
    feasible: result.feasible,
    summary: result.feasible
      ? result.combination && result.combination.length > 0
        ? 'Feasible at that time.'
        : 'Nothing is needed that could stop this time.'
      : `Not feasible at that time.`,
    suggestedIds,
    suggestedNames: suggestedIds.map((id) => names.resource(id)),
    reasons: result.reasons.map((reason) => describeReason(reason, names)),
    selection: selectionView,
  };
}
