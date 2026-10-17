import { routingProvider, type RoutingProvider } from '@/lib/adapters/routing';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { maximumMatching } from '@/lib/domain/matching';
import { listResources } from '@/lib/domain/resources/resources';
import type { TravelMode } from '@/lib/domain/resources/travel-mode';
import { freeWindows } from '@/lib/domain/scheduling/availability';
import { listOperatingHours, openWindows } from '@/lib/domain/scheduling/operating-hours';
import {
  listResourceAvailabilityExceptions,
  listResourceOpenWindows,
} from '@/lib/domain/scheduling/resource-availability';
import {
  judgeTravel,
  newRouteBook,
  planTravel,
  resolveRoutes,
  type Neighbour,
  type Place,
  type ResourceTravel,
  type ResourceTravelFacts,
  type RouteBook,
  type TravelFacts,
  type TravelReason,
} from '@/lib/domain/scheduling/travel';
import { parseWindow, zonedDayRange, type Window } from '@/lib/domain/scheduling/window';
import { isEligible, listResourceRequirements } from '@/lib/domain/work-items/requirements';

/**
 * Can this kind of work happen in this interval — and with whom.
 *
 *   requirements → eligible → open → free → one distinct resource per required slot → a combination
 *
 * **This composes; it does not recompute.** Which resources could do the work is the requirement's
 * (`isEligible`). When each is open — organization hours ∩ its own hours − its time off — is
 * `listResourceOpenWindows`, the same reader Schedule and booking use. What it is already committed
 * to is the assignments' `occupies`, the same rows the exclusion constraint guards. This file
 * adds only the part none of those answers: whether *enough distinct* resources exist *at once* —
 * `maximumMatching`, the matcher that already decides whether a job's assignments cover its needs.
 *
 * **Eligibility ≠ availability ≠ assignment ≠ feasibility.** A resource may be eligible and not
 * working, free and not eligible, or assigned and no longer able. Each is its own fact and a reason
 * below names which one failed.
 *
 * **Advisory.** Every answer is a snapshot. The assignment triggers and the exclusion
 * constraint decide at commit, in the same transaction as the write; nothing here weakens them. It
 * persists nothing and caches nothing — it is derived from state that changes by the minute.
 *
 * **Deterministic, not optimal.** The combination is stable (requirement position then id, resource
 * by name then id, preferred resources first when asked) and is *a* valid one, never a ranked best:
 * no distance, load, cost or preference scoring lives here. No weather, service area or route order.
 *
 * **Travel is one more edge condition, drawn before matching.** `requirements → eligible → open →
 * free → travel-feasible → one distinct resource per slot`. A resource that is free but cannot arrive
 * is not matched and another one may be — travel is never checked after the fact on a combination
 * already chosen, which could miss a complete one. What travel *is* (the gaps, the legs, the router)
 * is `travel.ts`; here it is only a resource's `travel` state.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** One position the work needs: `quantity` distinct resources out of `eligible`, best first. */
export type Demand = {
  /** The requirement's id; null only for the implicit one-resource demand of a public type that needs nothing. */
  requirementId: string | null;
  position: number;
  quantity: number;
  /** Resource ids that could fill it, in resource order (name, then id). */
  eligible: string[];
};

/** Why a resource cannot take part in an interval. Eligibility is not here: it is the demand's. */
export type ResourceProblem = 'not_working' | 'unavailable' | 'committed';

/**
 * A closed vocabulary of facts, never prose. Words belong to the screen; the numbers and ids here
 * are what it renders from. Nothing is listed that the data cannot show (no travel, weather, area).
 */
export type FeasibilityReason =
  | { code: 'outside_organization_hours' }
  | { code: 'no_eligible_resource'; requirementId: string | null }
  | { code: 'insufficient_eligible_resources'; requirementId: string | null; required: number; eligible: number }
  | { code: 'resource_not_working'; requirementId: string | null; resourceId: string }
  | { code: 'resource_unavailable'; requirementId: string | null; resourceId: string }
  | { code: 'resource_already_committed'; requirementId: string | null; resourceId: string }
  | {
      code: 'insufficient_free_resources';
      requirementId: string | null;
      required: number;
      eligible: number;
      open: number;
      free: number;
    }
  | { code: 'requirements_compete_for_same_resources'; requirementIds: (string | null)[] }
  | TravelReason;

export type RequirementFeasibility = {
  requirementId: string | null;
  quantity: number;
  eligibleResourceIds: string[];
  openResourceIds: string[];
  freeResourceIds: string[];
  /** Free *and* able to arrive: what the matching actually drew edges to. Equal to `freeResourceIds` where travel is not in play. */
  travelFeasibleResourceIds: string[];
  /** The resources the (maximum) matching gave this requirement — all of them when it is feasible. */
  matchedResourceIds: string[];
  missingQuantity: number;
  satisfied: boolean;
};

export type FeasibleAssignment = { requirementId: string | null; resourceId: string };

export type FeasibilityResult = {
  feasible: boolean;
  interval: Window;
  requirements: RequirementFeasibility[];
  /** One distinct resource per required slot, or null when none exists. Empty when nothing is required. */
  combination: FeasibleAssignment[] | null;
  reasons: FeasibilityReason[];
  /** Doubts that did not stop the answer: travel that could not be verified for a resource the combination uses. */
  warnings: TravelReason[];
  /** What travel says for each resource it was asked about — the measured legs, for a screen to show. */
  travel: ResourceTravel[];
};

/** What each resource is doing in the interval — the engine's only per-resource input. */
export type ResourceState = {
  id: string;
  /** Position in resource order; lower is preferred. */
  rank: number;
  problem: ResourceProblem | null;
  /** Only for a resource that is free: whether it can arrive. Absent where travel is not in play. */
  travel?: ResourceTravel;
};

/**
 * What an unverifiable journey does to the answer. Staff are *warned* and may still schedule; a
 * public visitor is never offered a time nobody could confirm is reachable.
 */
export type UnknownTravelPolicy = 'allow' | 'exclude';

function travelBlocks(state: ResourceState | undefined, unknown: UnknownTravelPolicy): boolean {
  const travel = state?.travel?.state;
  return travel === 'infeasible' || (travel === 'unknown' && unknown === 'exclude');
}

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

function orderedDemands(demands: readonly Demand[]): Demand[] {
  return [...demands].sort((a, b) => a.position - b.position || (a.requirementId ?? '').localeCompare(b.requirementId ?? ''));
}

type Slot = { demand: Demand; index: number };

function expand(demands: readonly Demand[]): Slot[] {
  return demands.flatMap((demand) => Array.from({ length: demand.quantity }, (_, index) => ({ demand, index })));
}

/** Candidate order for a slot: preferred resources first, then by rank. */
function candidateOrder(ids: readonly string[], rank: ReadonlyMap<string, number>, prefer: ReadonlySet<string>): string[] {
  return [...ids].sort(
    (a, b) =>
      Number(prefer.has(b)) - Number(prefer.has(a)) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b),
  );
}

/**
 * Whether one interval is feasible, from facts already gathered. No I/O, no clock.
 *
 * Edges are drawn only where a resource is eligible **and** open **and** uncommitted — eligibility
 * and time are evaluated together, never "pick some, then see if they are free" — and the matching
 * then finds whether every required slot can have a distinct one. Bounded by slots × edges; no
 * combination is ever enumerated.
 */
export function evaluateFeasibility(input: {
  interval: Window;
  demands: readonly Demand[];
  states: ReadonlyMap<string, ResourceState>;
  /** The interval lies outside the organization's own hours (it has said when it is open). */
  outsideOrganizationHours?: boolean;
  /** Resources to use where several would do — a preference, never a requirement. */
  prefer?: readonly string[];
  /** Defaults to `allow`: staff are told, not stopped. */
  unknownTravel?: UnknownTravelPolicy;
}): FeasibilityResult {
  const unknownTravel = input.unknownTravel ?? 'allow';
  const demands = orderedDemands(input.demands);
  const prefer = new Set(input.prefer ?? []);
  const rank = new Map([...input.states.values()].map((state) => [state.id, state.rank]));

  const perRequirement = demands.map((demand) => {
    const eligible = demand.eligible.filter((id) => input.states.has(id));
    const open = eligible.filter((id) => {
      const problem = input.states.get(id)!.problem;
      return problem !== 'not_working' && problem !== 'unavailable';
    });
    const free = open.filter((id) => input.states.get(id)!.problem !== 'committed');
    const arrives = free.filter((id) => !travelBlocks(input.states.get(id), unknownTravel));
    return { demand, eligible, open, free, arrives };
  });

  // Matching works in dense indexes, in resource order; map an id to one and back.
  const ids = [...input.states.keys()].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b));
  const index = new Map(ids.map((id, i) => [id, i]));

  const slots = expand(demands);
  const matching = maximumMatching(slots.length, (slotIndex) => {
    const entry = perRequirement.find((candidate) => candidate.demand === slots[slotIndex].demand)!;
    return candidateOrder(entry.arrives, rank, prefer).map((id) => index.get(id)!);
  });

  const matchedByDemand = new Map<Demand, string[]>();
  slots.forEach((slot, slotIndex) => {
    const resourceIndex = matching.get(slotIndex);
    if (resourceIndex === undefined) return;
    matchedByDemand.set(slot.demand, [...(matchedByDemand.get(slot.demand) ?? []), ids[resourceIndex]]);
  });

  const requirements: RequirementFeasibility[] = perRequirement.map((entry) => {
    const matched = matchedByDemand.get(entry.demand) ?? [];
    return {
      requirementId: entry.demand.requirementId,
      quantity: entry.demand.quantity,
      eligibleResourceIds: entry.eligible,
      openResourceIds: entry.open,
      freeResourceIds: entry.free,
      travelFeasibleResourceIds: entry.arrives,
      matchedResourceIds: matched,
      missingQuantity: entry.demand.quantity - matched.length,
      satisfied: matched.length === entry.demand.quantity,
    };
  });

  const complete = slots.length === matching.size;
  const closed = input.outsideOrganizationHours === true;
  const feasible = complete && !closed;

  const reasons: FeasibilityReason[] = [];
  // The constraint chain, outermost first: business closed → nobody could do it → not working →
  // booked → cannot arrive → competing for the same people. A deeper reason is never reported over a shallower one.
  if (closed) reasons.push({ code: 'outside_organization_hours' });

  if (!closed && !complete) {
    for (const entry of perRequirement) {
      const { demand } = entry;
      const required = demand.quantity;
      if (entry.eligible.length === 0) {
        reasons.push({ code: 'no_eligible_resource', requirementId: demand.requirementId });
      } else if (entry.eligible.length < required) {
        reasons.push({
          code: 'insufficient_eligible_resources',
          requirementId: demand.requirementId,
          required,
          eligible: entry.eligible.length,
        });
      }
    }
    // Where a requirement cannot be filled, say what is wrong with each resource that could have: not
    // working, on time off, or booked — so "Jo is not working" is not hidden behind "Alex is booked".
    // The summary count is added only once enough resources are open that being booked is the story.
    for (const entry of perRequirement) {
      if (entry.eligible.length < entry.demand.quantity) continue;
      if (entry.free.length >= entry.demand.quantity) continue;
      for (const id of entry.eligible) {
        const problem = input.states.get(id)!.problem;
        const requirementId = entry.demand.requirementId;
        if (problem === 'not_working') reasons.push({ code: 'resource_not_working', requirementId, resourceId: id });
        else if (problem === 'unavailable') reasons.push({ code: 'resource_unavailable', requirementId, resourceId: id });
        else if (problem === 'committed') reasons.push({ code: 'resource_already_committed', requirementId, resourceId: id });
      }
      if (entry.open.length >= entry.demand.quantity) {
        reasons.push({
          code: 'insufficient_free_resources',
          requirementId: entry.demand.requirementId,
          required: entry.demand.quantity,
          eligible: entry.eligible.length,
          open: entry.open.length,
          free: entry.free.length,
        });
      }
    }
    // Free but unable to arrive: say which resource, and what its journey needs, so "Jo is booked"
    // is never hidden behind "Alex cannot reach it in time".
    const told = new Set<string>();
    for (const entry of perRequirement) {
      if (entry.free.length < entry.demand.quantity || entry.arrives.length >= entry.demand.quantity) continue;
      for (const id of entry.free) {
        if (!travelBlocks(input.states.get(id), unknownTravel)) continue;
        for (const reason of input.states.get(id)!.travel!.reasons) {
          const signature = JSON.stringify(reason);
          if (told.has(signature)) continue;
          told.add(signature);
          reasons.push(reason);
        }
      }
    }
    // Each requirement could be met alone, yet not all at once: they want the same people.
    if (perRequirement.every((entry) => entry.arrives.length >= entry.demand.quantity)) {
      reasons.push({
        code: 'requirements_compete_for_same_resources',
        requirementIds: requirements.filter((entry) => !entry.satisfied).map((entry) => entry.requirementId),
      });
    }
  }

  let combination: FeasibleAssignment[] | null = null;
  if (feasible) {
    combination = slots.map((slot, slotIndex) => ({
      requirementId: slot.demand.requirementId,
      resourceId: ids[matching.get(slotIndex)!],
    }));
  }

  // Doubts that did not stop an answer: a resource the combination uses whose journey is unverified.
  const used = new Set((combination ?? []).map((entry) => entry.resourceId));
  const warnings = [...used].flatMap((id) => {
    const travel = input.states.get(id)?.travel;
    return travel?.state === 'unknown' ? travel.reasons : [];
  });
  const travel = [...input.states.values()].flatMap((state) =>
    state.travel && state.travel.state !== 'not_applicable' && (feasible ? used.has(state.id) : true) ? [state.travel] : [],
  );

  return { feasible, interval: input.interval, requirements, combination, reasons, warnings, travel };
}

export type AssignedResourceCheck = {
  /** Every assigned resource is working and free for the interval. */
  allAvailable: boolean;
  resources: { resourceId: string; problem: ResourceProblem | null; travel?: ResourceTravel }[];
  /** No assigned resource is *known* unable to arrive. An unverified journey is a warning, not a failure. */
  allTravelFeasible: boolean;
  /** The assigned resources cover every requirement, each filling one slot. Independent of `allAvailable`. */
  requirementsMet: boolean;
  requirements: RequirementFeasibility[];
  /** Both: what a job needs scheduling at a time nobody is refused. */
  ok: boolean;
};

/**
 * Whether *these exact* resources can take the interval: each must be working and free (extras
 * beyond the requirements included — a van the job carries must be there too), and they are read
 * against the requirements through the same matcher. Covering the requirements and being available
 * are separate answers: a partly staffed job is allowed, and zero requirements are trivially met.
 */
export function evaluateAssignedResources(input: {
  demands: readonly Demand[];
  states: ReadonlyMap<string, ResourceState>;
  resourceIds: readonly string[];
}): AssignedResourceCheck {
  const demands = orderedDemands(input.demands);
  const assigned = [...new Set(input.resourceIds)];
  const resources = assigned.map((resourceId) => ({
    resourceId,
    problem: input.states.get(resourceId)?.problem ?? null,
    travel: input.states.get(resourceId)?.travel,
  }));

  const slots = expand(demands);
  const matching = maximumMatching(slots.length, (slotIndex) =>
    assigned.flatMap((id, i) => (slots[slotIndex].demand.eligible.includes(id) ? [i] : [])),
  );

  const matchedByDemand = new Map<Demand, string[]>();
  slots.forEach((slot, slotIndex) => {
    const i = matching.get(slotIndex);
    if (i === undefined) return;
    matchedByDemand.set(slot.demand, [...(matchedByDemand.get(slot.demand) ?? []), assigned[i]]);
  });

  const requirements: RequirementFeasibility[] = demands.map((demand) => {
    const matched = matchedByDemand.get(demand) ?? [];
    return {
      requirementId: demand.requirementId,
      quantity: demand.quantity,
      eligibleResourceIds: demand.eligible,
      openResourceIds: [],
      freeResourceIds: [],
      travelFeasibleResourceIds: [],
      matchedResourceIds: matched,
      missingQuantity: demand.quantity - matched.length,
      satisfied: matched.length === demand.quantity,
    };
  });

  const allAvailable = resources.every((entry) => entry.problem === null);
  const requirementsMet = requirements.every((entry) => entry.satisfied);
  const allTravelFeasible = resources.every((entry) => entry.travel?.state !== 'infeasible');
  return { allAvailable, resources, allTravelFeasible, requirementsMet, requirements, ok: allAvailable && requirementsMet && allTravelFeasible };
}

// ---------------------------------------------------------------------------
// Facts for a range, gathered once
// ---------------------------------------------------------------------------

/**
 * Everything the core needs for a range, read in a bounded number of queries however many
 * resources, requirements or candidate intervals there are. Intervals are then judged in memory.
 */
export type FeasibilityData = {
  demands: Demand[];
  ranks: Map<string, number>;
  /** When each resource is open: organization hours ∩ its own hours − its time off. */
  open: Map<string, Window[]>;
  /** What each resource is committed to (the occupied windows, buffer included). */
  committed: Map<string, Window[]>;
  /** Each resource's time off, to tell *unavailable* from *not working*. Absent for a public visitor. */
  exceptions: Map<string, Window[]>;
  /** The organization's own open periods per day if it has said, else null (never closed). Absent for a public visitor, whose slots already come from open windows. */
  organizationHours: { timeZone: string; hours: Awaited<ReturnType<typeof listOperatingHours>> } | null;
  /**
   * Present only when some resource is said to travel. The facts a journey is judged from, the
   * router's answers so far this request, and what an unverifiable one does to the answer.
   */
  travel?: { facts: TravelFacts; book: RouteBook; unknown: UnknownTravelPolicy };
};

const ms = (iso: string) => new Date(iso).getTime();

function covers(windows: readonly Window[], interval: Window): boolean {
  const start = ms(interval.startsAt);
  const end = ms(interval.endsAt);
  return windows.some((window) => ms(window.startsAt) <= start && end <= ms(window.endsAt));
}

function overlapsAny(windows: readonly Window[], interval: Window): boolean {
  const start = ms(interval.startsAt);
  const end = ms(interval.endsAt);
  return windows.some((window) => ms(window.startsAt) < end && start < ms(window.endsAt));
}

function problemFor(id: string, data: FeasibilityData, interval: Window): ResourceProblem | null {
  if (!covers(data.open.get(id) ?? [], interval)) {
    return overlapsAny(data.exceptions.get(id) ?? [], interval) ? 'unavailable' : 'not_working';
  }
  return overlapsAny(data.committed.get(id) ?? [], interval) ? 'committed' : null;
}

/** Whether a free resource can arrive — asked only after open and uncommitted, so no route is spent on a resource already ruled out. */
function travelPlanFor(id: string, data: FeasibilityData, interval: Window) {
  const travel = data.travel!;
  return planTravel({
    resourceId: id,
    facts: travel.facts.resources.get(id),
    candidate: travel.facts.candidate,
    bufferMinutes: travel.facts.bufferMinutes,
    interval,
    // The open window the interval sits in is where this working period begins and ends.
    period: (data.open.get(id) ?? []).find((window) => covers([window], interval)) ?? null,
  });
}

function stateFor(id: string, data: FeasibilityData, interval: Window): ResourceState {
  const problem = problemFor(id, data, interval);
  const state: ResourceState = { id, rank: data.ranks.get(id) ?? 0, problem };
  if (problem === null && data.travel) state.travel = judgeTravel(travelPlanFor(id, data, interval), data.travel.book);
  return state;
}

function statesFor(data: FeasibilityData, interval: Window): Map<string, ResourceState> {
  return new Map([...data.ranks.keys()].map((id) => [id, stateFor(id, data, interval)]));
}

/** The interval lies outside the days' open periods when the organization has declared hours. */
function outsideHours(data: FeasibilityData, interval: Window): boolean {
  const configured = data.organizationHours;
  if (!configured || configured.hours.length === 0) return false;

  const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: configured.timeZone }).format(new Date(interval.startsAt));
  const periods = openWindows(startDate, configured.timeZone, configured.hours, zonedDayRange(startDate, configured.timeZone));
  return !covers(periods, interval);
}

/** The pure verdict for one interval over gathered facts. Shared by the single check and slot discovery. */
export function judgeInterval(
  data: FeasibilityData,
  interval: Window,
  options: { prefer?: readonly string[] } = {},
): FeasibilityResult {
  return evaluateFeasibility({
    interval,
    demands: data.demands,
    states: statesFor(data, interval),
    outsideOrganizationHours: outsideHours(data, interval),
    prefer: options.prefer,
    unknownTravel: data.travel?.unknown,
  });
}

/**
 * Ask the router for every journey the given intervals need, **once each**, before they are judged.
 * Only resources that could fill a requirement (or are named in `alsoResourceIds`) *and* are open and
 * uncommitted for an interval are planned, so nothing is routed for a resource already ruled out.
 * Judging stays synchronous and reads what this left in the book; a journey the router could not
 * answer reads as unknown. Nothing is persisted.
 */
export async function prepareTravel(
  data: FeasibilityData,
  intervals: readonly Window[],
  provider: RoutingProvider | null,
  alsoResourceIds: readonly string[] = [],
): Promise<void> {
  if (!data.travel) return;
  const relevant = new Set([...data.demands.flatMap((demand) => demand.eligible), ...alsoResourceIds]);

  const legs: { from: NonNullable<Place['point']>; to: NonNullable<Place['point']>; departureAt?: string }[] = [];
  for (const interval of intervals) {
    for (const id of relevant) {
      if (!data.ranks.has(id) || problemFor(id, data, interval) !== null) continue;
      for (const leg of travelPlanFor(id, data, interval).routed) {
        legs.push({ from: leg.from.point, to: leg.to.point, departureAt: leg.departureAt });
      }
    }
  }
  await resolveRoutes(data.travel.book, provider, legs);
}

function groupById(rows: { resource_id: string | null; occupies: unknown }[]): Map<string, Window[]> {
  const grouped = new Map<string, Window[]>();
  for (const row of rows) {
    // `supabase gen types` has no TypeScript for a Postgres range.
    const window = parseWindow(row.occupies as string | null);
    if (!window || !row.resource_id) continue;
    grouped.set(row.resource_id, [...(grouped.get(row.resource_id) ?? []), window]);
  }
  return grouped;
}

/**
 * The facts for staff: requirements, every resource, open windows, other work's commitments, time
 * off and the organization's hours — a constant handful of reads for any number of resources.
 * `excludeWorkItemId` leaves one job's own assignments out of the commitments, so rescheduling a job
 * is never blocked by itself; every other job still blocks.
 */
export async function loadFeasibilityData(
  db: Db,
  input: {
    organizationId: string;
    typeId: string;
    range: Window;
    timeZone: string;
    excludeWorkItemId?: string;
    /** The candidate work's canonical Location, when it has one. Travel is judged to and from it. */
    locationId?: string | null;
  },
): Promise<FeasibilityData> {
  const rangeText = `[${input.range.startsAt},${input.range.endsAt})`;

  const [requirements, resourceList, hours, committedRows, exceptions] = await Promise.all([
    listResourceRequirements(db, { organizationId: input.organizationId, typeId: input.typeId }),
    listResources(db, { organizationId: input.organizationId, limit: 1000 }),
    listOperatingHours(db, { organizationId: input.organizationId }),
    (() => {
      let query = db
        .from('work_item_resource_assignments')
        .select('resource_id, work_item_id, occupies')
        .eq('organization_id', input.organizationId)
        .overlaps('occupies', rangeText);
      if (input.excludeWorkItemId) query = query.neq('work_item_id', input.excludeWorkItemId);
      return query;
    })(),
    listResourceAvailabilityExceptions(db, { organizationId: input.organizationId, within: input.range }),
  ]);
  if (committedRows.error) throw new DomainError(committedRows.error.message, 'feasibility.commitments_failed');

  const resources = [...resourceList].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const ids = resources.map((resource) => resource.id);
  // Where somebody is *between* jobs needs the working period around the interval, not only the interval.
  const travelling = resources.some((resource) => resource.travelMode !== null);
  const context = travelling ? widen(input.range) : input.range;
  const open = await listResourceOpenWindows(db, { organizationId: input.organizationId, within: context, resourceIds: ids });
  const travel = travelling ? await loadTravelFacts(db, input, resources, context) : undefined;

  const exceptionWindows = new Map<string, Window[]>();
  for (const exception of exceptions) {
    exceptionWindows.set(exception.resourceId, [...(exceptionWindows.get(exception.resourceId) ?? []), exception.window]);
  }

  return {
    demands: [...requirements]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((requirement) => ({
        requirementId: requirement.id,
        position: requirement.position,
        quantity: requirement.quantity,
        eligible: resources.filter((resource) => isEligible(resource, requirement)).map((resource) => resource.id),
      })),
    ranks: new Map(ids.map((id, i) => [id, i])),
    open,
    committed: groupById(committedRows.data ?? []),
    exceptions: exceptionWindows,
    organizationHours: { timeZone: input.timeZone, hours },
    ...(travel ? { travel: { facts: travel, book: newRouteBook(), unknown: 'allow' as const } } : {}),
  };
}

/** A working period is bounded by a day in practice; this is how far either side of an interval its neighbours are looked for. */
const CONTEXT_HOURS = 24;

function widen(range: Window): Window {
  return {
    startsAt: new Date(ms(range.startsAt) - CONTEXT_HOURS * 3_600_000).toISOString(),
    endsAt: new Date(ms(range.endsAt) + CONTEXT_HOURS * 3_600_000).toISOString(),
  };
}

/**
 * The staff reader's travel facts: each travelling resource's neighbours in the surrounding period,
 * the Locations they and the candidate sit at (canonical `locations` rows, with the coordinates they
 * already hold), each resource's base, and the business's buffer. A constant handful of reads for any
 * number of resources; nothing is geocoded here, and a Location with no coordinates stays a place
 * with no point.
 */
async function loadTravelFacts(
  db: Db,
  input: { organizationId: string; excludeWorkItemId?: string; locationId?: string | null },
  resources: readonly { id: string; travelMode: TravelMode | null; baseLocationId: string | null }[],
  context: Window,
): Promise<TravelFacts> {
  const mobile = resources.filter((resource) => resource.travelMode === 'mobile').map((resource) => resource.id);

  let assignments = db
    .from('work_item_resource_assignments')
    .select('resource_id, work_item_id, occupies')
    .eq('organization_id', input.organizationId)
    .in('resource_id', mobile)
    .overlaps('occupies', `[${context.startsAt},${context.endsAt})`);
  if (input.excludeWorkItemId) assignments = assignments.neq('work_item_id', input.excludeWorkItemId);

  const [assigned, organization] = await Promise.all([
    mobile.length > 0 ? assignments : Promise.resolve({ data: [], error: null }),
    db.from('organizations').select('buffer_minutes').eq('id', input.organizationId).maybeSingle(),
  ]);
  if (assigned.error) throw new DomainError(assigned.error.message, 'feasibility.travel_failed');
  if (organization.error) throw new DomainError(organization.error.message, 'feasibility.travel_failed');

  const workItemIds = [...new Set((assigned.data ?? []).map((row) => row.work_item_id))];
  const items =
    workItemIds.length > 0
      ? await db.from('work_items').select('id, location_id').eq('organization_id', input.organizationId).in('id', workItemIds)
      : { data: [], error: null };
  if (items.error) throw new DomainError(items.error.message, 'feasibility.travel_failed');
  const locationOfWork = new Map((items.data ?? []).map((item) => [item.id, item.location_id]));

  const locationIds = [
    ...new Set(
      [
        input.locationId ?? null,
        ...resources.map((resource) => resource.baseLocationId),
        ...locationOfWork.values(),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const locations =
    locationIds.length > 0
      ? await db.from('locations').select('id, latitude, longitude').eq('organization_id', input.organizationId).in('id', locationIds)
      : { data: [], error: null };
  if (locations.error) throw new DomainError(locations.error.message, 'feasibility.travel_failed');
  const places = new Map<string, Place>(
    (locations.data ?? []).map((row) => [
      row.id,
      { locationId: row.id, point: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null },
    ]),
  );
  const placeOf = (id: string | null | undefined): Place | null => (id ? (places.get(id) ?? null) : null);

  const neighbours = new Map<string, Neighbour[]>();
  for (const row of assigned.data ?? []) {
    const occupies = parseWindow(row.occupies as string | null);
    if (!occupies) continue;
    neighbours.set(row.resource_id, [
      ...(neighbours.get(row.resource_id) ?? []),
      { workItemId: row.work_item_id, occupies, place: placeOf(locationOfWork.get(row.work_item_id)) },
    ]);
  }

  return {
    candidate: placeOf(input.locationId),
    bufferMinutes: organization.data?.buffer_minutes ?? 0,
    resources: new Map<string, ResourceTravelFacts>(
      resources.map((resource) => [
        resource.id,
        { mode: resource.travelMode, base: placeOf(resource.baseLocationId), neighbours: neighbours.get(resource.id) ?? [] },
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * **The** answer for one interval: feasible or not, the combination, how each requirement fares,
 * and — when it is not — structured reasons. The staff reader; a public visitor's reader is
 * `loadPublicFeasibilityData` and gets slot times only.
 */
export async function checkWorkTypeFeasibility(
  db: Db,
  input: {
    organizationId: string;
    workTypeId: string;
    timeZone: string;
    start: string;
    end: string;
    /** A job being moved: its own current assignments do not count against it. */
    excludeWorkItemId?: string;
    /** Resources to use where several would do (the job's current ones, say). A preference only. */
    prefer?: readonly string[];
    /** The work's canonical Location, so travel can be judged to and from it. */
    locationId?: string | null;
    /** The router. Omitted, this deployment's own; `null` means none, and journeys read as unknown. Tests pass a fake. */
    routing?: RoutingProvider | null;
  },
): Promise<FeasibilityResult> {
  const interval = { startsAt: new Date(input.start).toISOString(), endsAt: new Date(input.end).toISOString() };
  if (ms(interval.endsAt) <= ms(interval.startsAt)) {
    throw new DomainError('A window must end after it starts.', 'feasibility.window_invalid');
  }
  const data = await loadFeasibilityData(db, {
    organizationId: input.organizationId,
    typeId: input.workTypeId,
    range: interval,
    timeZone: input.timeZone,
    excludeWorkItemId: input.excludeWorkItemId,
    locationId: input.locationId,
  });
  await prepareTravel(data, [interval], input.routing === undefined ? await routingProvider() : input.routing);
  return judgeInterval(data, interval, { prefer: input.prefer });
}

/** Whether exactly these resources can take the interval, and whether they cover what the work needs. */
export async function checkAssignedResources(
  db: Db,
  input: {
    organizationId: string;
    workTypeId: string;
    timeZone: string;
    start: string;
    end: string;
    resourceIds: readonly string[];
    excludeWorkItemId?: string;
    locationId?: string | null;
    routing?: RoutingProvider | null;
  },
): Promise<AssignedResourceCheck & { interval: Window }> {
  const interval = { startsAt: new Date(input.start).toISOString(), endsAt: new Date(input.end).toISOString() };
  if (ms(interval.endsAt) <= ms(interval.startsAt)) {
    throw new DomainError('A window must end after it starts.', 'feasibility.window_invalid');
  }
  const data = await loadFeasibilityData(db, {
    organizationId: input.organizationId,
    typeId: input.workTypeId,
    range: interval,
    timeZone: input.timeZone,
    excludeWorkItemId: input.excludeWorkItemId,
    locationId: input.locationId,
  });
  await prepareTravel(data, [interval], input.routing === undefined ? await routingProvider() : input.routing, input.resourceIds);
  const check = evaluateAssignedResources({
    demands: data.demands,
    states: statesFor(data, interval),
    resourceIds: input.resourceIds,
  });
  return { ...check, interval };
}

export type FeasibleSlot = { startsAt: string; endsAt: string; combination: FeasibleAssignment[] };

/**
 * Every interval in `range` for which a complete combination exists.
 *
 * **Duration and cadence are two inputs.** `durationMinutes` is how long the work takes;
 * `stepMinutes` is how far apart candidate starts are. Today's booking caller passes the same number
 * for both, as it always implicitly did — but the engine does not assume it, so notice and cadence
 * rules can later change one without the other.
 *
 * Candidates are not every minute: they step from the start of each resource's free windows. Each
 * is then judged in memory over the facts loaded once for the range.
 */
export function feasibleSlots(data: FeasibilityData, input: SlotSearch): FeasibleSlot[] {
  return candidateIntervals(data, input).flatMap((interval) => {
    const result = judgeInterval(data, interval);
    return result.feasible && result.combination ? [{ ...interval, combination: result.combination }] : [];
  });
}

/**
 * `feasibleSlots` for a range where journeys matter: the same candidates, with the router asked —
 * each distinct leg once — for the ones that survive eligibility, hours and commitments before any is
 * judged. Where `data.travel` is absent this is `feasibleSlots` with an await.
 */
export async function feasibleSlotsWithTravel(
  data: FeasibilityData,
  input: SlotSearch,
  provider: RoutingProvider | null,
): Promise<FeasibleSlot[]> {
  await prepareTravel(data, candidateIntervals(data, input), provider);
  return feasibleSlots(data, input);
}

type SlotSearch = {
  range: Window;
  durationMinutes: number;
  stepMinutes: number;
  /**
   * Where a candidate may begin, when something other than "where a free window begins" decides —
   * a caller's cadence. Maps an instant to the first allowed start at or after it. Omitted, the
   * engine steps from each free window's start, as staff scheduling and every older caller expect.
   */
  align?: (instantMs: number) => number;
  /** Exclusive upper bound on a start, in ms; a caller's horizon. */
  startBefore?: number;
};

/** The intervals worth judging: stepped from each eligible resource's free windows, never minute by minute. */
function candidateIntervals(data: FeasibilityData, input: SlotSearch): Window[] {
  const duration = input.durationMinutes * 60_000;
  const step = input.stepMinutes * 60_000;
  if (!(duration > 0) || !(step > 0)) return [];

  const relevant = new Set(data.demands.length > 0 ? data.demands.flatMap((demand) => demand.eligible) : data.ranks.keys());
  const rangeStart = ms(input.range.startsAt);
  const rangeEnd = ms(input.range.endsAt);

  // Candidate starts come from each resource's *free* windows — open time with commitments removed by
  // `freeWindows`, the one subtraction — stepping from where each one begins. So a booking that ends
  // at 10:30 leaves 10:30 offered, exactly as booking always did, and no minute-by-minute scan runs.
  const starts = new Set<number>();
  for (const id of relevant) {
    for (const window of data.open.get(id) ?? []) {
      for (const free of freeWindows(window, data.committed.get(id) ?? [], { minimumMinutes: input.durationMinutes })) {
        const first = input.align ? input.align(Math.max(ms(free.startsAt), rangeStart)) : ms(free.startsAt);
        for (let t = first; t + duration <= ms(free.endsAt); t += step) {
          if (input.startBefore !== undefined && t >= input.startBefore) break;
          if (t >= rangeStart && t + duration <= rangeEnd) starts.add(t);
        }
      }
    }
  }

  return [...starts].sort((a, b) => a - b).map((start) => ({
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + duration).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Public visitors: ids and times only
// ---------------------------------------------------------------------------

/**
 * The facts a booking visitor's session may read — three reads: which resources could fill which
 * slots (`bookable_candidates`, ids only), when each is open, and what is committed (the published
 * `resource_commitments`). No names, capabilities, time off or reasons: those are staff's, and a
 * visitor is told a time is offered or it is not.
 */
export async function loadPublicFeasibilityData(
  db: Db,
  input: {
    organizationId: string;
    typeId: string;
    range: Window;
    /** A booking of the caller's own to set aside, so a reschedule is judged without conflicting with itself. */
    excludeWorkItemId?: string;
  },
): Promise<FeasibilityData> {
  const rangeText = `[${input.range.startsAt},${input.range.endsAt})`;

  const [candidates, commitments, own] = await Promise.all([
    db.rpc('bookable_candidates', { p_type_id: input.typeId }),
    db.from('resource_commitments').select('resource_id, occupies').eq('organization_id', input.organizationId).overlaps('occupies', rangeText),
    input.excludeWorkItemId ? db.rpc('booking_own_commitments', { p_work_item_id: input.excludeWorkItemId }) : Promise.resolve(null),
  ]);
  if (candidates.error) throw new DomainError(candidates.error.message, 'feasibility.candidates_failed');
  if (commitments.error) throw new DomainError(commitments.error.message, 'feasibility.commitments_failed');
  if (own?.error) throw new DomainError(own.error.message, 'feasibility.commitments_failed');

  // A resource cannot hold two commitments over the same time (the exclusion constraint), so a row
  // identical to one of the booking's own is that booking and nothing else.
  const ownKeys = new Set((own?.data ?? []).map((row) => `${row.resource_id}|${String(row.occupies)}`));
  const committedRows = (commitments.data ?? []).filter((row) => !ownKeys.has(`${row.resource_id}|${String(row.occupies)}`));

  const ranks = new Map<string, number>();
  const demandRows = new Map<string, Demand>();
  for (const row of candidates.data ?? []) {
    ranks.set(row.resource_id, row.resource_rank);
    const key = row.requirement_id ?? 'implicit';
    const demand = demandRows.get(key) ?? {
      requirementId: row.requirement_id,
      position: row.req_position,
      quantity: row.quantity,
      eligible: [],
    };
    demand.eligible.push(row.resource_id);
    demandRows.set(key, demand);
  }
  for (const demand of demandRows.values()) {
    demand.eligible.sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
  }

  const open = await listResourceOpenWindows(db, {
    organizationId: input.organizationId,
    within: input.range,
    resourceIds: [...ranks.keys()],
  });

  return {
    demands: [...demandRows.values()],
    ranks,
    open,
    committed: groupById(committedRows),
    exceptions: new Map(),
    organizationHours: null,
  };
}

/**
 * One read, both questions staff ask while choosing a time: *can this work happen then, and with
 * whom* (`feasibility`, with the job's own current assignments set aside and preferred if they still
 * work), and — when somebody has ticked resources — *can exactly these take it* (`selection`). The
 * facts load once and are judged twice, so the two answers cannot disagree.
 */
export async function assessInterval(
  db: Db,
  input: {
    organizationId: string;
    workTypeId: string;
    timeZone: string;
    start: string;
    end: string;
    excludeWorkItemId?: string;
    /** The resources currently ticked, or assigned. Empty means no selection to judge. */
    resourceIds?: readonly string[];
    locationId?: string | null;
    routing?: RoutingProvider | null;
  },
): Promise<{ feasibility: FeasibilityResult; selection: (AssignedResourceCheck & { interval: Window }) | null }> {
  const interval = { startsAt: new Date(input.start).toISOString(), endsAt: new Date(input.end).toISOString() };
  if (Number.isNaN(ms(interval.startsAt)) || Number.isNaN(ms(interval.endsAt)) || ms(interval.endsAt) <= ms(interval.startsAt)) {
    throw new DomainError('A window must end after it starts.', 'feasibility.window_invalid');
  }
  const data = await loadFeasibilityData(db, {
    organizationId: input.organizationId,
    typeId: input.workTypeId,
    range: interval,
    timeZone: input.timeZone,
    excludeWorkItemId: input.excludeWorkItemId,
    locationId: input.locationId,
  });
  const chosen = input.resourceIds ?? [];
  await prepareTravel(data, [interval], input.routing === undefined ? await routingProvider() : input.routing, chosen);
  return {
    feasibility: judgeInterval(data, interval, { prefer: chosen }),
    selection:
      chosen.length > 0
        ? { ...evaluateAssignedResources({ demands: data.demands, states: statesFor(data, interval), resourceIds: chosen }), interval }
        : null,
  };
}
