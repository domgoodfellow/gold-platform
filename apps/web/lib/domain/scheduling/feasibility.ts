import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { maximumMatching } from '@/lib/domain/matching';
import { listResources } from '@/lib/domain/resources/resources';
import { freeWindows } from '@/lib/domain/scheduling/availability';
import { listOperatingHours, openWindows } from '@/lib/domain/scheduling/operating-hours';
import {
  listResourceAvailabilityExceptions,
  listResourceOpenWindows,
} from '@/lib/domain/scheduling/resource-availability';
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
 * **Advisory (I6).** Every answer is a snapshot. The assignment triggers and the exclusion
 * constraint decide at commit, in the same transaction as the write; nothing here weakens them. It
 * persists nothing and caches nothing — it is derived from state that changes by the minute.
 *
 * **Deterministic, not optimal.** The combination is stable (requirement position then id, resource
 * by name then id, preferred resources first when asked) and is *a* valid one, never a ranked best:
 * no distance, load, cost or preference scoring lives here. No travel, routing or weather either.
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
  | { code: 'requirements_compete_for_same_resources'; requirementIds: (string | null)[] };

export type RequirementFeasibility = {
  requirementId: string | null;
  quantity: number;
  eligibleResourceIds: string[];
  openResourceIds: string[];
  freeResourceIds: string[];
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
};

/** What each resource is doing in the interval — the engine's only per-resource input. */
export type ResourceState = {
  id: string;
  /** Position in resource order; lower is preferred. */
  rank: number;
  problem: ResourceProblem | null;
};

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
}): FeasibilityResult {
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
    return { demand, eligible, open, free };
  });

  // Matching works in dense indexes, in resource order; map an id to one and back.
  const ids = [...input.states.keys()].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b));
  const index = new Map(ids.map((id, i) => [id, i]));

  const slots = expand(demands);
  const matching = maximumMatching(slots.length, (slotIndex) => {
    const entry = perRequirement.find((candidate) => candidate.demand === slots[slotIndex].demand)!;
    return candidateOrder(entry.free, rank, prefer).map((id) => index.get(id)!);
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
  // booked → competing for the same people. A deeper reason is never reported over a shallower one.
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
    // Each requirement could be met alone, yet not all at once: they want the same people.
    if (perRequirement.every((entry) => entry.free.length >= entry.demand.quantity)) {
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

  return { feasible, interval: input.interval, requirements, combination, reasons };
}

export type AssignedResourceCheck = {
  /** Every assigned resource is working and free for the interval. */
  allAvailable: boolean;
  resources: { resourceId: string; problem: ResourceProblem | null }[];
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
      matchedResourceIds: matched,
      missingQuantity: demand.quantity - matched.length,
      satisfied: matched.length === demand.quantity,
    };
  });

  const allAvailable = resources.every((entry) => entry.problem === null);
  const requirementsMet = requirements.every((entry) => entry.satisfied);
  return { allAvailable, resources, requirementsMet, requirements, ok: allAvailable && requirementsMet };
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

function stateFor(id: string, data: FeasibilityData, interval: Window): ResourceState {
  let problem: ResourceProblem | null = null;
  if (!covers(data.open.get(id) ?? [], interval)) {
    problem = overlapsAny(data.exceptions.get(id) ?? [], interval) ? 'unavailable' : 'not_working';
  } else if (overlapsAny(data.committed.get(id) ?? [], interval)) {
    problem = 'committed';
  }
  return { id, rank: data.ranks.get(id) ?? 0, problem };
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
  });
}

function groupById(rows: { resource_id: string | null; occupies: unknown }[]): Map<string, Window[]> {
  const grouped = new Map<string, Window[]>();
  for (const row of rows) {
    // `supabase gen types` has no TypeScript for a Postgres range (D15).
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
  input: { organizationId: string; typeId: string; range: Window; timeZone: string; excludeWorkItemId?: string },
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
  const open = await listResourceOpenWindows(db, { organizationId: input.organizationId, within: input.range, resourceIds: ids });

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
  });
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
  });
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
export function feasibleSlots(
  data: FeasibilityData,
  input: { range: Window; durationMinutes: number; stepMinutes: number },
): FeasibleSlot[] {
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
        for (let t = ms(free.startsAt); t + duration <= ms(free.endsAt); t += step) {
          if (t >= rangeStart && t + duration <= rangeEnd) starts.add(t);
        }
      }
    }
  }

  const slots: FeasibleSlot[] = [];
  for (const start of [...starts].sort((a, b) => a - b)) {
    const interval = { startsAt: new Date(start).toISOString(), endsAt: new Date(start + duration).toISOString() };
    const result = judgeInterval(data, interval);
    if (result.feasible && result.combination) slots.push({ ...interval, combination: result.combination });
  }
  return slots;
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
  input: { organizationId: string; typeId: string; range: Window },
): Promise<FeasibilityData> {
  const rangeText = `[${input.range.startsAt},${input.range.endsAt})`;

  const [candidates, commitments] = await Promise.all([
    db.rpc('bookable_candidates', { p_type_id: input.typeId }),
    db.from('resource_commitments').select('resource_id, occupies').eq('organization_id', input.organizationId).overlaps('occupies', rangeText),
  ]);
  if (candidates.error) throw new DomainError(candidates.error.message, 'feasibility.candidates_failed');
  if (commitments.error) throw new DomainError(commitments.error.message, 'feasibility.commitments_failed');

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
    committed: groupById(commitments.data ?? []),
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
  });
  const chosen = input.resourceIds ?? [];
  return {
    feasibility: judgeInterval(data, interval, { prefer: chosen }),
    selection:
      chosen.length > 0
        ? { ...evaluateAssignedResources({ demands: data.demands, states: statesFor(data, interval), resourceIds: chosen }), interval }
        : null,
  };
}
