import type {
  AssignedResourceCheck,
  FeasibilityReason,
  FeasibilityResult,
} from '@/lib/domain/scheduling/feasibility';
import type { ResourceTravel, TravelLeg } from '@/lib/domain/scheduling/travel';

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

/** A journey's length as a person says it: whole minutes, rounded up, never "0 min" for a real trip. */
function minutes(totalSeconds: number): string {
  return `${Math.max(1, Math.ceil(totalSeconds / 60))} min`;
}

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
    case 'travel_from_previous_too_long':
      return `${names.resource(reason.resourceId)} needs about ${minutes(reason.requiredSeconds)} from the previous job, but only ${minutes(reason.availableSeconds)} are available.`;
    case 'travel_from_base_too_long':
      return `${names.resource(reason.resourceId)} needs about ${minutes(reason.requiredSeconds)} from its base, but only ${minutes(reason.availableSeconds)} are available.`;
    case 'travel_to_next_too_long':
      return `${names.resource(reason.resourceId)} needs about ${minutes(reason.requiredSeconds)} to reach its next job, but only ${minutes(reason.availableSeconds)} are available.`;
    case 'travel_route_not_found':
      return `There is no drivable route for ${names.resource(reason.resourceId)} ${
        reason.leg === 'next' ? 'to its next job' : reason.leg === 'base' ? 'from its base' : 'from the previous job'
      }.`;
    case 'fixed_resource_wrong_location':
      return `${names.resource(reason.resourceId)} stays at its base and cannot work at that place.`;
    case 'travel_origin_unknown':
      return `Travel time could not be verified for ${names.resource(reason.resourceId)}: ${
        reason.previousWorkItemId ? 'the previous job has no location' : 'it has no earlier job and no base'
      }.`;
    case 'travel_destination_unknown':
      return `Travel time could not be verified for ${names.resource(reason.resourceId)}: ${
        reason.nextWorkItemId ? 'its next job has no location' : 'this job has no location with coordinates'
      }.`;
    case 'routing_unavailable':
      return `Travel time could not be verified for ${names.resource(reason.resourceId)}.`;
  }
}

/** One measured leg as a sentence, with what the schedule leaves — numbers in words, so nothing relies on colour or an icon. */
function describeLeg(leg: TravelLeg, resourceName: string): string {
  const where = leg.kind === 'previous' ? 'from the previous job' : leg.kind === 'base' ? 'from its base' : 'to its next job';
  const room = leg.availableSeconds === null ? '' : `, ${minutes(leg.availableSeconds)} available`;
  return leg.requiredSeconds === 0
    ? `${resourceName} — no travel ${where}.`
    : `${resourceName} — about ${minutes(leg.requiredSeconds)} ${where}${room}.`;
}

function travelLines(travel: readonly ResourceTravel[], names: FeasibilityNames): string[] {
  return travel.flatMap((entry) => entry.legs.map((leg) => describeLeg(leg, names.resource(entry.resourceId))));
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
  /** Doubts that do not stop the time: a journey nobody could check. Staff may still schedule. */
  warnings: string[];
  /** The journeys the suggestion relies on, with what each needs and what the schedule leaves. */
  travel: string[];
  /** About the exact resources ticked, when any were. */
  selection: { ok: boolean; lines: string[]; warnings: string[] } | null;
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
    const selectionWarnings: string[] = [];
    for (const entry of selection.resources) {
      for (const reason of entry.travel?.reasons ?? []) {
        (entry.travel?.state === 'infeasible' ? lines : selectionWarnings).push(describeReason(reason, names));
      }
      if (entry.problem === 'not_working') lines.push(`${names.resource(entry.resourceId)} is not working then.`);
      else if (entry.problem === 'unavailable') lines.push(`${names.resource(entry.resourceId)} is unavailable then.`);
      else if (entry.problem === 'committed') lines.push(`${names.resource(entry.resourceId)} is already booked then.`);
    }
    for (const requirement of selection.requirements) {
      if (!requirement.satisfied) {
        lines.push(`${names.requirement(requirement.requirementId)} requirement missing${requirement.missingQuantity > 1 ? ` (${requirement.missingQuantity})` : ''}.`);
      }
    }
    selectionView = { ok: selection.ok, lines, warnings: selectionWarnings };
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
    warnings: result.warnings.map((reason) => describeReason(reason, names)),
    travel: result.feasible ? travelLines(result.travel, names) : [],
    selection: selectionView,
  };
}
