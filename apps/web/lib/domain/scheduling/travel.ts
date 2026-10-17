import { RoutingError, type Coordinates, type RouteResult, type RoutingFailure, type RoutingProvider } from '@/lib/adapters/routing';
import type { TravelMode } from '@/lib/domain/resources/travel-mode';
import type { Window } from '@/lib/domain/scheduling/window';

/**
 * Can this resource get from where it is to this work, and on to what comes next.
 *
 *   previous commitment → candidate → next commitment, each leg against the gap the schedule leaves
 *
 * **Travel is derived, never stored.** It depends on whatever happens to be adjacent, so moving the
 * next job changes it; it is not a column on a work item, and `work_items.occupies` never includes it.
 * The gaps are measured between *occupied* windows — the previous job's `occupies` already ends after
 * the business's one trailing buffer, and the candidate's own buffer is added once, here — so the
 * static buffer is never counted a second time as if it were driving.
 *
 * **Three honest outcomes, never a silent zero.** A leg whose places are both known is *ok* or
 * *infeasible*. A leg whose origin, destination or router is unknown is *unknown*: nothing was
 * learned, which is not the same as "no travel needed". A resource that is not said to travel is
 * *not applicable*, which is what every resource was before this existed.
 *
 * **Travel ≠ eligibility ≠ working ≠ commitment.** A resource can be eligible, open and free and
 * still be unable to arrive — that is this file's only claim, and nothing here re-derives the others.
 *
 * Advisory, like the rest of feasibility: the answer is a snapshot, and a router cannot run
 * inside the database, so travel is re-asked by the server immediately before a commit and is not a
 * database constraint. This file touches no database; the vendor is behind `RoutingProvider`.
 */

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** A canonical Location as routing needs it. `point` is null when the Location has no coordinates yet. */
export type Place = { locationId: string; point: Coordinates | null };

/** A commitment adjacent to the candidate. `place` is null when that work has no Location. */
export type Neighbour = { workItemId: string; occupies: Window; place: Place | null };

export type ResourceTravelFacts = {
  mode: TravelMode | null;
  /** Where the resource starts a working period with no earlier job in it, or where a fixed one lives. */
  base: Place | null;
  neighbours: Neighbour[];
};

export type TravelFacts = {
  /** The candidate work's Location, or null when it has none. */
  candidate: Place | null;
  /** The business's trailing buffer — the one that already ends every `occupies`. */
  bufferMinutes: number;
  resources: Map<string, ResourceTravelFacts>;
};

/**
 * What surrounds a candidate for one resource. Derived, never persisted: it is the nearest
 * commitments in the same working period, and a base to fall back on when there is no earlier one.
 */
export type ResourceRouteContext = {
  resourceId: string;
  previous?: { workItemId: string; place: Place | null; occupiedUntil: string };
  next?: { workItemId: string; place: Place | null; occupiedFrom: string };
  fallbackBase?: Place;
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type LegKind = 'previous' | 'base' | 'next';

/** Facts, never prose. The numbers are what a screen renders its sentence from. */
export type TravelReason =
  | { code: 'travel_origin_unknown'; resourceId: string; previousWorkItemId?: string }
  | { code: 'travel_destination_unknown'; resourceId: string; nextWorkItemId?: string }
  | { code: 'routing_unavailable'; resourceId: string }
  | { code: 'travel_route_not_found'; resourceId: string; leg: LegKind; otherWorkItemId?: string }
  | {
      code: 'travel_from_previous_too_long';
      resourceId: string;
      previousWorkItemId: string;
      availableSeconds: number;
      requiredSeconds: number;
      distanceMeters: number;
    }
  | {
      code: 'travel_from_base_too_long';
      resourceId: string;
      availableSeconds: number;
      requiredSeconds: number;
      distanceMeters: number;
    }
  | {
      code: 'travel_to_next_too_long';
      resourceId: string;
      nextWorkItemId: string;
      availableSeconds: number;
      requiredSeconds: number;
      distanceMeters: number;
    }
  | { code: 'fixed_resource_wrong_location'; resourceId: string };

/** A leg that was measured: what it needs, what the schedule leaves, and where the number came from. */
export type TravelLeg = {
  kind: LegKind;
  otherWorkItemId?: string;
  fromLocationId: string;
  toLocationId: string;
  requiredSeconds: number;
  /** Null when nothing bounds it (no known start of the working period). */
  availableSeconds: number | null;
  distanceMeters: number;
  /** Null for a leg that needed no routing (same place). */
  provider: string | null;
  calculatedAt: string | null;
};

export type TravelState = 'ok' | 'infeasible' | 'unknown' | 'not_applicable';

export type ResourceTravel = {
  resourceId: string;
  state: TravelState;
  reasons: TravelReason[];
  legs: TravelLeg[];
};

// ---------------------------------------------------------------------------
// Route context
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const seconds = (fromMs: number, toMs: number) => Math.floor((toMs - fromMs) / 1000);

/**
 * The nearest previous and next commitment for a resource around an interval, and its base.
 *
 * *Previous* is the one whose occupied window ends last at or before the interval starts; *next* the
 * one whose occupied window starts first at or after the interval ends. Both are confined to the
 * working period the interval is in (when it is known) — yesterday's last job is not where somebody
 * starts today; the base is. A job being moved is already absent from `neighbours`.
 */
export function routeContext(
  resourceId: string,
  facts: ResourceTravelFacts,
  interval: Window,
  period: Window | null,
): ResourceRouteContext {
  const start = ms(interval.startsAt);
  const end = ms(interval.endsAt);
  const periodStart = period ? ms(period.startsAt) : Number.NEGATIVE_INFINITY;
  const periodEnd = period ? ms(period.endsAt) : Number.POSITIVE_INFINITY;

  let previous: Neighbour | undefined;
  let next: Neighbour | undefined;
  for (const neighbour of facts.neighbours) {
    const from = ms(neighbour.occupies.startsAt);
    const until = ms(neighbour.occupies.endsAt);
    if (until <= start && until > periodStart) {
      if (!previous || until > ms(previous.occupies.endsAt) || (until === ms(previous.occupies.endsAt) && neighbour.workItemId < previous.workItemId)) {
        previous = neighbour;
      }
    } else if (from >= end && from < periodEnd) {
      if (!next || from < ms(next.occupies.startsAt) || (from === ms(next.occupies.startsAt) && neighbour.workItemId < next.workItemId)) {
        next = neighbour;
      }
    }
  }

  return {
    resourceId,
    ...(previous ? { previous: { workItemId: previous.workItemId, place: previous.place, occupiedUntil: previous.occupies.endsAt } } : {}),
    ...(next ? { next: { workItemId: next.workItemId, place: next.place, occupiedFrom: next.occupies.startsAt } } : {}),
    ...(!previous && facts.base ? { fallbackBase: facts.base } : {}),
  };
}

// ---------------------------------------------------------------------------
// Planning: which legs need a route, and which are already settled
// ---------------------------------------------------------------------------

type PlannedLeg = {
  kind: LegKind;
  otherWorkItemId?: string;
  from: Place & { point: Coordinates };
  to: Place & { point: Coordinates };
  availableSeconds: number | null;
  /** When the trip would begin, as a hint to a router that has a traffic model. */
  departureAt: string;
};

/** What can be said before any router is asked. */
export type TravelPlan = {
  resourceId: string;
  applicable: boolean;
  /** Reasons already known: unknown places, a fixed resource somewhere else. */
  settled: TravelReason[];
  /** Legs that cost nothing — the same place on both ends — and never reach a provider. */
  free: TravelLeg[];
  /** Legs that need a duration from a router. */
  routed: PlannedLeg[];
};

function samePlace(a: Place, b: Place): boolean {
  if (a.locationId === b.locationId) return true;
  return a.point !== null && b.point !== null && a.point.latitude === b.point.latitude && a.point.longitude === b.point.longitude;
}

function hasPoint(place: Place): place is Place & { point: Coordinates } {
  return place.point !== null;
}

export function planTravel(input: {
  resourceId: string;
  facts: ResourceTravelFacts | undefined;
  candidate: Place | null;
  bufferMinutes: number;
  interval: Window;
  /** The open window the interval sits in: where a working period begins and ends. Null when unknown. */
  period: Window | null;
}): TravelPlan {
  const { resourceId, facts, candidate, interval } = input;
  const plan: TravelPlan = { resourceId, applicable: false, settled: [], free: [], routed: [] };
  if (!facts || facts.mode === null) return plan;
  plan.applicable = true;

  // A fixed resource is at its base and nowhere else: it can take work there, and is never routed.
  if (facts.mode === 'fixed') {
    if (!facts.base) plan.settled.push({ code: 'travel_origin_unknown', resourceId });
    else if (!candidate) plan.settled.push({ code: 'travel_destination_unknown', resourceId });
    else if (!samePlace(facts.base, candidate)) plan.settled.push({ code: 'fixed_resource_wrong_location', resourceId });
    return plan;
  }

  const context = routeContext(resourceId, facts, interval, input.period);
  const origin = context.previous ? context.previous.place : (context.fallbackBase ?? null);

  // A candidate with no Location is not a reason for alarm when nothing adjacent has a place either —
  // there is then no journey to verify. Where something does, it cannot be verified.
  if (!candidate) {
    const somethingToReach = Boolean(origin) || Boolean(context.next?.place);
    if (somethingToReach) plan.settled.push({ code: 'travel_destination_unknown', resourceId });
    plan.applicable = somethingToReach;
    return plan;
  }

  const startMs = ms(interval.startsAt);
  const endMs = ms(interval.endsAt);

  const addLeg = (leg: {
    kind: LegKind;
    otherWorkItemId?: string;
    from: Place;
    to: Place;
    availableSeconds: number | null;
    departureAt: string;
    unknownOrigin: TravelReason;
    unknownDestination: TravelReason;
  }) => {
    if (samePlace(leg.from, leg.to)) {
      plan.free.push({
        kind: leg.kind,
        otherWorkItemId: leg.otherWorkItemId,
        fromLocationId: leg.from.locationId,
        toLocationId: leg.to.locationId,
        requiredSeconds: 0,
        availableSeconds: leg.availableSeconds,
        distanceMeters: 0,
        provider: null,
        calculatedAt: null,
      });
      return;
    }
    if (!hasPoint(leg.from)) plan.settled.push(leg.unknownOrigin);
    else if (!hasPoint(leg.to)) plan.settled.push(leg.unknownDestination);
    else plan.routed.push({ kind: leg.kind, otherWorkItemId: leg.otherWorkItemId, from: leg.from, to: leg.to, availableSeconds: leg.availableSeconds, departureAt: leg.departureAt });
  };

  // Into the candidate: from the previous job, else from the base.
  if (context.previous) {
    const previous = context.previous;
    if (!previous.place) {
      plan.settled.push({ code: 'travel_origin_unknown', resourceId, previousWorkItemId: previous.workItemId });
    } else {
      addLeg({
        kind: 'previous',
        otherWorkItemId: previous.workItemId,
        from: previous.place,
        to: candidate,
        availableSeconds: seconds(ms(previous.occupiedUntil), startMs),
        departureAt: previous.occupiedUntil,
        unknownOrigin: { code: 'travel_origin_unknown', resourceId, previousWorkItemId: previous.workItemId },
        unknownDestination: { code: 'travel_destination_unknown', resourceId },
      });
    }
  } else if (context.fallbackBase) {
    addLeg({
      kind: 'base',
      from: context.fallbackBase,
      to: candidate,
      availableSeconds: input.period ? seconds(ms(input.period.startsAt), startMs) : null,
      departureAt: input.period ? input.period.startsAt : interval.startsAt,
      unknownOrigin: { code: 'travel_origin_unknown', resourceId },
      unknownDestination: { code: 'travel_destination_unknown', resourceId },
    });
  } else {
    // No earlier job and no base: where this resource starts is simply not known. It is not "at the
    // candidate", which would be the one assumption that makes every job reachable.
    plan.settled.push({ code: 'travel_origin_unknown', resourceId });
  }

  // Out of the candidate: to the next job, if there is one. No return to base is assumed after the last.
  if (context.next) {
    const next = context.next;
    if (!next.place) {
      plan.settled.push({ code: 'travel_destination_unknown', resourceId, nextWorkItemId: next.workItemId });
    } else {
      const departs = endMs + input.bufferMinutes * 60_000;
      addLeg({
        kind: 'next',
        otherWorkItemId: next.workItemId,
        from: candidate,
        to: next.place,
        availableSeconds: Math.max(0, seconds(departs, ms(next.occupiedFrom))),
        departureAt: new Date(departs).toISOString(),
        unknownOrigin: { code: 'travel_origin_unknown', resourceId },
        unknownDestination: { code: 'travel_destination_unknown', resourceId, nextWorkItemId: next.workItemId },
      });
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// The route book: one request's answers from the router
// ---------------------------------------------------------------------------

export type RouteOutcome = { ok: true; result: RouteResult } | { ok: false; failure: RoutingFailure };

/**
 * What the router said during one request, so an identical leg is asked once however many resources
 * and candidate times need it. Request-scoped on purpose: nothing here outlives the request, and
 * nothing is persisted — a durable cache waits for evidence that volume needs one.
 */
export type RouteBook = {
  outcomes: Map<string, RouteOutcome>;
  /** Provider calls made so far. */
  calls: number;
  /** Set once the provider is unreachable or limiting: the rest of the request does not keep asking. */
  halted: boolean;
};

export function newRouteBook(): RouteBook {
  return { outcomes: new Map(), calls: 0, halted: false };
}

/** Departure time is deliberately not part of the key: no implementation here has a traffic model, so the answer does not vary with it. */
export function routeKey(from: Coordinates, to: Coordinates): string {
  return `${from.latitude},${from.longitude}>${to.latitude},${to.longitude}`;
}

const CONCURRENCY = 6;

/**
 * Ask the router for every leg not already answered — each distinct pair once, a handful at a time.
 * A provider that is down or limiting stops the asking for the rest of the request (the legs it
 * leaves unanswered read as *unknown*), and a missing provider asks nothing at all.
 */
export async function resolveRoutes(
  book: RouteBook,
  provider: RoutingProvider | null,
  legs: readonly { from: Coordinates; to: Coordinates; departureAt?: string }[],
): Promise<void> {
  if (!provider) return;

  const wanted = new Map<string, { from: Coordinates; to: Coordinates; departureAt?: string }>();
  for (const leg of legs) {
    const key = routeKey(leg.from, leg.to);
    if (!book.outcomes.has(key) && !wanted.has(key)) wanted.set(key, leg);
  }

  const queue = [...wanted.entries()];
  for (let i = 0; i < queue.length && !book.halted; i += CONCURRENCY) {
    await Promise.all(
      queue.slice(i, i + CONCURRENCY).map(async ([key, leg]) => {
        book.calls += 1;
        try {
          const result = await provider.route({ origin: leg.from, destination: leg.to, departureAt: leg.departureAt, mode: 'driving' });
          book.outcomes.set(key, { ok: true, result });
        } catch (error) {
          const failure = error instanceof RoutingError ? error.failure : 'provider_unavailable';
          // "No drivable route" and "bad coordinates" are answers about this pair; an outage is not.
          if (failure === 'route_not_found' || failure === 'invalid_coordinates') {
            book.outcomes.set(key, { ok: false, failure });
          } else {
            book.halted = true;
          }
        }
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

const TOO_LONG = {
  previous: 'travel_from_previous_too_long',
  base: 'travel_from_base_too_long',
  next: 'travel_to_next_too_long',
} as const;

/** The verdict for one resource from its plan and what the router has said. Pure. */
export function judgeTravel(plan: TravelPlan, book: RouteBook): ResourceTravel {
  const { resourceId } = plan;
  if (!plan.applicable) return { resourceId, state: 'not_applicable', reasons: [], legs: [] };

  const reasons: TravelReason[] = [...plan.settled];
  const legs: TravelLeg[] = [...plan.free];
  let infeasible = reasons.some((reason) => reason.code === 'fixed_resource_wrong_location');
  let unknown = reasons.some((reason) => reason.code !== 'fixed_resource_wrong_location');
  let routerSilent = false;

  for (const leg of plan.routed) {
    const outcome = book.outcomes.get(routeKey(leg.from.point, leg.to.point));
    if (!outcome) {
      routerSilent = true;
      continue;
    }
    if (!outcome.ok) {
      if (outcome.failure === 'route_not_found') {
        reasons.push({ code: 'travel_route_not_found', resourceId, leg: leg.kind, otherWorkItemId: leg.otherWorkItemId });
        infeasible = true;
      } else {
        routerSilent = true;
      }
      continue;
    }

    const { durationSeconds, distanceMeters, provider, calculatedAt } = outcome.result;
    legs.push({
      kind: leg.kind,
      otherWorkItemId: leg.otherWorkItemId,
      fromLocationId: leg.from.locationId,
      toLocationId: leg.to.locationId,
      requiredSeconds: durationSeconds,
      availableSeconds: leg.availableSeconds,
      distanceMeters,
      provider,
      calculatedAt,
    });
    if (leg.availableSeconds !== null && durationSeconds > leg.availableSeconds) {
      infeasible = true;
      const common = { resourceId, availableSeconds: leg.availableSeconds, requiredSeconds: durationSeconds, distanceMeters };
      if (leg.kind === 'previous') reasons.push({ code: TOO_LONG.previous, previousWorkItemId: leg.otherWorkItemId!, ...common });
      else if (leg.kind === 'next') reasons.push({ code: TOO_LONG.next, nextWorkItemId: leg.otherWorkItemId!, ...common });
      else reasons.push({ code: TOO_LONG.base, ...common });
    }
  }

  if (routerSilent) {
    reasons.push({ code: 'routing_unavailable', resourceId });
    unknown = true;
  }

  // A leg that cannot be reached is a fact; one that could not be checked is only a doubt. The fact wins.
  const state: TravelState = infeasible ? 'infeasible' : unknown ? 'unknown' : 'ok';
  return { resourceId, state, reasons, legs };
}
