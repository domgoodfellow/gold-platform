import { describe, expect, it } from 'vitest';
import { RoutingError, type Coordinates, type RouteRequest, type RouteResult, type RoutingProvider } from '@/lib/adapters/routing';
import {
  evaluateAssignedResources,
  feasibleSlotsWithTravel,
  judgeInterval,
  prepareTravel,
  type Demand,
  type FeasibilityData,
} from '@/lib/domain/scheduling/feasibility';
import {
  judgeTravel,
  newRouteBook,
  planTravel,
  resolveRoutes,
  routeContext,
  type Neighbour,
  type Place,
  type ResourceTravelFacts,
} from '@/lib/domain/scheduling/travel';
import type { Window } from '@/lib/domain/scheduling/window';

/**
 * Travel feasibility, with a router that is a table. Nothing here touches a network or a database:
 * the question is what the engine does with durations it is told, so the durations are the test's.
 * Places are numbered points, so a leg is "from 1 to 2" and the fake can answer by what it is asked.
 */

const at = (clock: string, day = '06') => `2027-04-${day}T${clock}:00.000Z`;
const win = (from: string, to: string): Window => ({ startsAt: at(from), endsAt: at(to) });
const MIN = 60;

const POINTS: Record<string, Coordinates> = {
  A: { latitude: 1, longitude: 1 },
  B: { latitude: 2, longitude: 2 },
  C: { latitude: 3, longitude: 3 },
  SHOP: { latitude: 4, longitude: 4 },
  D: { latitude: 5, longitude: 5 },
};
const nameOf = (point: Coordinates) => Object.entries(POINTS).find(([, p]) => p.latitude === point.latitude)![0];
const place = (id: string, withPoint = true): Place => ({ locationId: id, point: withPoint ? POINTS[id] : null });

/** A router that answers from a table of minutes, and remembers what it was asked. */
class FakeRouter implements RoutingProvider {
  readonly name = 'fake';
  readonly asked: string[] = [];
  constructor(
    private readonly minutes: Record<string, number | 'no_route' | 'down'>,
    private readonly fallback: number | 'no_route' | 'down' = 10,
  ) {}
  async route(request: RouteRequest): Promise<RouteResult> {
    const pair = `${nameOf(request.origin)}>${nameOf(request.destination)}`;
    this.asked.push(pair);
    const answer = this.minutes[pair] ?? this.fallback;
    if (answer === 'no_route') throw new RoutingError('route_not_found', 'none');
    if (answer === 'down') throw new RoutingError('provider_unavailable', 'down');
    return { distanceMeters: answer * 1000, durationSeconds: answer * MIN, provider: 'fake', calculatedAt: '2027-04-01T00:00:00.000Z' };
  }
}

const neighbour = (workItemId: string, from: string, to: string, at_: string | null): Neighbour => ({
  workItemId,
  occupies: win(from, to),
  place: at_ ? place(at_) : null,
});

const mobile = (over: Partial<ResourceTravelFacts> = {}): ResourceTravelFacts => ({ mode: 'mobile', base: null, neighbours: [], ...over });

const OPEN = win('08:00', '18:00');

type Setup = {
  resources: Record<string, ResourceTravelFacts>;
  demands?: Demand[];
  candidate?: Place | null;
  buffer?: number;
  unknown?: 'allow' | 'exclude';
  open?: Record<string, Window[]>;
};

/** Facts for a day on which everybody works 08–18, with the demands given (or one person slot over everybody). */
function data(setup: Setup): FeasibilityData {
  const ids = Object.keys(setup.resources);
  return {
    demands: setup.demands ?? [{ requirementId: 'person', position: 0, quantity: 1, eligible: ids }],
    ranks: new Map(ids.map((id, i) => [id, i])),
    open: new Map(ids.map((id) => [id, setup.open?.[id] ?? [OPEN]])),
    committed: new Map(),
    exceptions: new Map(),
    organizationHours: null,
    travel: {
      facts: { candidate: setup.candidate === undefined ? place('B') : setup.candidate, bufferMinutes: setup.buffer ?? 0, resources: new Map(Object.entries(setup.resources)) },
      book: newRouteBook(),
      unknown: setup.unknown ?? 'allow',
    },
  };
}

async function judge(setup: Setup, router: RoutingProvider | null, interval = win('11:00', '12:00')) {
  const facts = data(setup);
  await prepareTravel(facts, [interval], router);
  return { facts, result: judgeInterval(facts, interval) };
}

describe('the route context around an interval', () => {
  const facts = mobile({
    neighbours: [neighbour('w1', '08:00', '09:00', 'A'), neighbour('w2', '09:30', '10:00', 'B'), neighbour('w3', '14:00', '15:00', 'C'), neighbour('w4', '16:00', '17:00', 'D')],
  });

  it('takes the nearest earlier commitment as previous, not the first one', () => {
    const context = routeContext('alex', facts, win('11:00', '12:00'), OPEN);
    expect(context.previous?.workItemId).toBe('w2');
    expect(context.previous?.occupiedUntil).toBe(at('10:00'));
    expect(context.fallbackBase).toBeUndefined();
  });

  it('takes the nearest later commitment as next', () => {
    expect(routeContext('alex', facts, win('11:00', '12:00'), OPEN).next?.workItemId).toBe('w3');
  });

  it('does not pick up work on another day as the place somebody starts from', () => {
    const earlier = mobile({
      base: place('SHOP'),
      neighbours: [{ workItemId: 'old', occupies: { startsAt: at('15:00', '05'), endsAt: at('16:00', '05') }, place: place('A') }],
    });
    const context = routeContext('alex', earlier, win('09:00', '10:00'), OPEN);
    expect(context.previous).toBeUndefined();
    expect(context.fallbackBase?.locationId).toBe('SHOP');
  });
});

describe('a leg against the gap the schedule leaves', () => {
  it('is feasible when the route fits: 22 minutes into a 30-minute gap', async () => {
    const router = new FakeRouter({ 'A>B': 22 });
    // Previous occupies until 10:15; the candidate starts 10:45.
    const { result } = await judge(
      { resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:15', 'A')] }) } },
      router,
      win('10:45', '11:45'),
    );
    expect(result.feasible).toBe(true);
    expect(result.travel[0].legs[0]).toMatchObject({ kind: 'previous', requiredSeconds: 22 * MIN, availableSeconds: 30 * MIN, provider: 'fake' });
  });

  it('is infeasible, with the numbers, when it does not: 38 minutes into 30', async () => {
    const router = new FakeRouter({ 'A>B': 38 });
    const { result } = await judge(
      { resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:15', 'A')] }) } },
      router,
      win('10:45', '11:45'),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContainEqual({
      code: 'travel_from_previous_too_long',
      resourceId: 'alex',
      previousWorkItemId: 'prev',
      availableSeconds: 30 * MIN,
      requiredSeconds: 38 * MIN,
      distanceMeters: 38_000,
    });
  });

  it('also checks the way out: the candidate must reach the next job', async () => {
    const router = new FakeRouter({ 'B>C': 40 });
    const { result } = await judge(
      { resources: { alex: mobile({ neighbours: [neighbour('next', '12:30', '13:30', 'C')] }) } },
      router,
    );
    expect(result.feasible).toBe(false);
    // 12:00 → 12:30, nothing after it to subtract: thirty minutes against forty.
    expect(result.reasons).toContainEqual(
      expect.objectContaining({ code: 'travel_to_next_too_long', nextWorkItemId: 'next', availableSeconds: 30 * MIN, requiredSeconds: 40 * MIN }),
    );
  });

  it('fails the resource when only one side fails: previous fits, next does not', async () => {
    const router = new FakeRouter({ 'A>B': 5, 'B>C': 90 });
    const { result } = await judge(
      { resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A'), neighbour('next', '12:30', '13:00', 'C')] }) } },
      router,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['travel_to_next_too_long']);
  });

  it('counts the business buffer once: the previous job already ends after it, and the candidate adds its own', async () => {
    // 15-minute buffer. Previous work 09:00–10:00 occupies until 10:15. Candidate 10:45–11:45 occupies
    // until 12:00. Next starts 12:30. Both gaps are exactly 30 minutes — not 15, which is what counting
    // the buffer a second time on either side would leave.
    const router = new FakeRouter({ 'A>B': 30, 'B>C': 30 });
    const { result } = await judge(
      {
        buffer: 15,
        resources: {
          alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:15', 'A'), neighbour('next', '12:30', '13:30', 'C')] }),
        },
      },
      router,
      win('10:45', '11:45'),
    );
    expect(result.feasible).toBe(true);
    expect(result.travel[0].legs.map((leg) => [leg.kind, leg.availableSeconds])).toEqual([
      ['previous', 30 * MIN],
      ['next', 30 * MIN],
    ]);
  });
});

describe('where somebody starts', () => {
  it('uses the base when there is no earlier job in the period', async () => {
    const router = new FakeRouter({ 'SHOP>B': 18 });
    const { result } = await judge({ resources: { alex: mobile({ base: place('SHOP') }) } }, router, win('09:00', '10:00'));
    expect(result.feasible).toBe(true);
    // 08:00 start of the period to 09:00.
    expect(result.travel[0].legs[0]).toMatchObject({ kind: 'base', requiredSeconds: 18 * MIN, availableSeconds: 60 * MIN });
    expect(router.asked).toEqual(['SHOP>B']);
  });

  it('refuses a first job the base cannot reach in time', async () => {
    const router = new FakeRouter({ 'SHOP>B': 18 });
    const { result } = await judge({ resources: { alex: mobile({ base: place('SHOP') }) } }, router, win('08:10', '09:10'));
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'travel_from_base_too_long', availableSeconds: 10 * MIN }));
  });

  it('says the origin is unknown — never zero — with no earlier job and no base', async () => {
    const router = new FakeRouter({});
    const { result } = await judge({ resources: { alex: mobile() } }, router);
    expect(result.travel[0].state).toBe('unknown');
    expect(result.warnings).toEqual([{ code: 'travel_origin_unknown', resourceId: 'alex' }]);
    // Staff are told, not stopped…
    expect(result.feasible).toBe(true);
    expect(router.asked).toEqual([]);
  });

  it('…and a public visitor is not offered what nobody could verify', async () => {
    const { result } = await judge({ unknown: 'exclude', resources: { alex: mobile() } }, new FakeRouter({}));
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([{ code: 'travel_origin_unknown', resourceId: 'alex' }]);
  });

  it('does not assume the base when the previous job has no place', async () => {
    const { result } = await judge(
      { resources: { alex: mobile({ base: place('SHOP'), neighbours: [neighbour('prev', '09:00', '10:00', null)] }) } },
      new FakeRouter({}),
    );
    expect(result.travel[0].reasons).toEqual([{ code: 'travel_origin_unknown', resourceId: 'alex', previousWorkItemId: 'prev' }]);
  });

  it('assumes no return to base after the last job', async () => {
    const router = new FakeRouter({ 'SHOP>B': 5 });
    const { result } = await judge({ resources: { alex: mobile({ base: place('SHOP') }) } }, router, win('17:00', '18:00'));
    expect(result.feasible).toBe(true);
    expect(router.asked).toEqual(['SHOP>B']);
  });
});

describe('when travel cannot be evaluated', () => {
  it('is not applicable for a resource nobody said travels', async () => {
    const router = new FakeRouter({});
    const { result } = await judge({ resources: { alex: { mode: null, base: null, neighbours: [] } } }, router);
    expect(result.feasible).toBe(true);
    expect(result.travel).toEqual([]);
    expect(router.asked).toEqual([]);
  });

  it('is unknown when the candidate has no place but somewhere has to be reached', async () => {
    const { result } = await judge(
      { candidate: null, resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } },
      new FakeRouter({}),
    );
    expect(result.warnings).toEqual([{ code: 'travel_destination_unknown', resourceId: 'alex' }]);
  });

  it('is not applicable when the candidate has no place and nothing adjacent has one either', async () => {
    const { result } = await judge({ candidate: null, resources: { alex: mobile() } }, new FakeRouter({}));
    expect(result.feasible).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('is unknown, not infeasible, when a place has no coordinates yet', async () => {
    const { result } = await judge(
      { candidate: place('B', false), resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } },
      new FakeRouter({}),
    );
    expect(result.travel[0].state).toBe('unknown');
  });

  it('reads an unreachable router as unknown, and does not crash', async () => {
    const router = new FakeRouter({}, 'down');
    const { result } = await judge({ resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } }, router);
    expect(result.feasible).toBe(true);
    expect(result.warnings).toEqual([{ code: 'routing_unavailable', resourceId: 'alex' }]);
  });

  it('reads no configured router the same way', async () => {
    const { result } = await judge({ resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } }, null);
    expect(result.warnings).toEqual([{ code: 'routing_unavailable', resourceId: 'alex' }]);
  });

  it('keeps "no drivable route" apart from an outage: it is a fact, and it stops the resource', async () => {
    const router = new FakeRouter({ 'A>B': 'no_route' });
    const { result } = await judge({ resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } }, router);
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([{ code: 'travel_route_not_found', resourceId: 'alex', leg: 'previous', otherWorkItemId: 'prev' }]);
  });
});

describe('the same place needs no router', () => {
  it('is zero travel, and never calls the provider, for the same Location', async () => {
    const router = new FakeRouter({});
    const { result } = await judge(
      { candidate: place('A'), resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) } },
      router,
    );
    expect(result.feasible).toBe(true);
    expect(router.asked).toEqual([]);
    expect(result.travel[0].legs[0]).toMatchObject({ requiredSeconds: 0, provider: null });
  });

  it('treats a base at the candidate the same way', async () => {
    const router = new FakeRouter({});
    const { result } = await judge({ candidate: place('SHOP'), resources: { alex: mobile({ base: place('SHOP') }) } }, router);
    expect(result.feasible).toBe(true);
    expect(router.asked).toEqual([]);
  });

  it('treats identical coordinates as the same place', () => {
    const plan = planTravel({
      resourceId: 'alex',
      facts: mobile({ neighbours: [{ workItemId: 'prev', occupies: win('09:00', '10:00'), place: { locationId: 'other-row', point: POINTS.A } }] }),
      candidate: { locationId: 'a-row', point: POINTS.A },
      bufferMinutes: 0,
      interval: win('11:00', '12:00'),
      period: OPEN,
    });
    expect(plan.routed).toEqual([]);
    expect(plan.free).toHaveLength(1);
  });
});

describe('a resource that stays where it is', () => {
  it('can take work at its base and is never routed', async () => {
    const router = new FakeRouter({});
    const { result } = await judge(
      { candidate: place('SHOP'), resources: { bay: { mode: 'fixed', base: place('SHOP'), neighbours: [] } } },
      router,
    );
    expect(result.feasible).toBe(true);
    expect(router.asked).toEqual([]);
  });

  it('cannot take work at a customer’s door', async () => {
    const router = new FakeRouter({});
    const { result } = await judge({ resources: { bay: { mode: 'fixed', base: place('SHOP'), neighbours: [] } } }, router);
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([{ code: 'fixed_resource_wrong_location', resourceId: 'bay' }]);
    expect(router.asked).toEqual([]);
  });
});

describe('travel decides who is matched, not whether the match is then spoiled', () => {
  it('chooses the resource that can arrive over a free one that cannot', async () => {
    const router = new FakeRouter({ 'A>B': 60, 'SHOP>B': 18 });
    const { result } = await judge(
      {
        resources: {
          alex: mobile({ neighbours: [neighbour('prev', '10:00', '10:30', 'A')] }),
          jo: mobile({ base: place('SHOP') }),
        },
      },
      router,
      win('10:45', '11:45'),
    );
    expect(result.feasible).toBe(true);
    expect(result.combination).toEqual([{ requirementId: 'person', resourceId: 'jo' }]);
    expect(result.requirements[0].freeResourceIds).toEqual(['alex', 'jo']);
    expect(result.requirements[0].travelFeasibleResourceIds).toEqual(['jo']);
    // Eligibility is untouched: Alex is still eligible and free, only unable to arrive.
    expect(result.requirements[0].eligibleResourceIds).toEqual(['alex', 'jo']);
  });

  it('finds the complete combination across requirements, resource by resource', async () => {
    // Alex cannot reach it and Van 1 cannot reach it; Jo and Van 2 can. Each resource has its own past.
    const router = new FakeRouter({ 'A>B': 90, 'C>B': 90, 'SHOP>B': 10, 'D>B': 10 });
    const { result } = await judge(
      {
        demands: [
          { requirementId: 'person', position: 0, quantity: 1, eligible: ['alex', 'jo'] },
          { requirementId: 'vehicle', position: 1, quantity: 1, eligible: ['van1', 'van2'] },
        ],
        resources: {
          alex: mobile({ neighbours: [neighbour('p1', '10:00', '10:30', 'A')] }),
          jo: mobile({ neighbours: [neighbour('p2', '10:00', '10:30', 'D')] }),
          van1: mobile({ neighbours: [neighbour('p3', '10:00', '10:30', 'C')] }),
          van2: mobile({ base: place('SHOP') }),
        },
      },
      router,
      win('11:00', '12:00'),
    );
    expect(result.combination).toEqual([
      { requirementId: 'person', resourceId: 'jo' },
      { requirementId: 'vehicle', resourceId: 'van2' },
    ]);
  });

  it('is judged per resource: the person arrives, the vehicle does not, so the combination fails', async () => {
    const router = new FakeRouter({ 'A>B': 5, 'C>B': 90 });
    const { result } = await judge(
      {
        demands: [
          { requirementId: 'person', position: 0, quantity: 1, eligible: ['alex'] },
          { requirementId: 'vehicle', position: 1, quantity: 1, eligible: ['van1'] },
        ],
        resources: {
          alex: mobile({ neighbours: [neighbour('p1', '10:00', '10:30', 'A')] }),
          van1: mobile({ neighbours: [neighbour('p3', '10:00', '10:30', 'C')] }),
        },
      },
      router,
      win('11:00', '12:00'),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([expect.objectContaining({ code: 'travel_from_previous_too_long', resourceId: 'van1' })]);
  });

  it('reports "booked" before "cannot arrive": an outer cause is never hidden behind a deeper one', () => {
    const facts = data({ resources: { alex: mobile({ neighbours: [neighbour('prev', '10:00', '10:30', 'A')] }) } });
    facts.committed.set('alex', [win('11:00', '12:00')]);
    const result = judgeInterval(facts, win('11:00', '12:00'));
    expect(result.reasons.map((r) => r.code)).toEqual(['resource_already_committed', 'insufficient_free_resources']);
  });
});

describe('exact assignments', () => {
  it('flags an extra resource that cannot arrive, and only warns about one that could not be checked', async () => {
    const router = new FakeRouter({ 'C>B': 90 });
    const facts = data({
      demands: [{ requirementId: 'person', position: 0, quantity: 1, eligible: ['alex'] }],
      resources: {
        alex: mobile({ base: place('SHOP') }),
        van: mobile({ neighbours: [neighbour('p', '10:00', '10:30', 'C')] }),
        spare: mobile(),
      },
    });
    const interval = win('11:00', '12:00');
    // The van and the spare are not eligible for any requirement: they are routed because they were ticked.
    await prepareTravel(facts, [interval], router, ['van', 'spare']);

    const states = new Map(
      ['alex', 'van', 'spare'].map((id, rank) => [
        id,
        {
          id,
          rank,
          problem: null,
          travel: judgeTravel(
            planTravel({ resourceId: id, facts: facts.travel!.facts.resources.get(id), candidate: place('B'), bufferMinutes: 0, interval, period: OPEN }),
            facts.travel!.book,
          ),
        },
      ]),
    );
    const check = evaluateAssignedResources({ demands: facts.demands, states, resourceIds: ['alex', 'van', 'spare'] });

    expect(check.requirementsMet).toBe(true);
    expect(check.allTravelFeasible).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.resources.map((r) => [r.resourceId, r.travel!.state])).toEqual([
      ['alex', 'ok'],
      ['van', 'infeasible'],
      ['spare', 'unknown'],
    ]);
    // A resource with an unverified journey alone does not make the set refuse.
    const onlyUnknown = evaluateAssignedResources({ demands: facts.demands, states, resourceIds: ['alex', 'spare'] });
    expect(onlyUnknown.ok).toBe(true);
  });
});

describe('asking the router', () => {
  it('asks each distinct leg once, however many resources and times need it', async () => {
    const router = new FakeRouter({});
    const resources = Object.fromEntries(['r1', 'r2', 'r3'].map((id) => [id, mobile({ neighbours: [neighbour(`p-${id}`, '09:00', '10:00', 'A')] })]));
    const facts = data({ resources });
    await prepareTravel(facts, [win('11:00', '12:00'), win('11:30', '12:30'), win('13:00', '14:00')], router);
    expect(router.asked).toEqual(['A>B']);
    // And a second preparation in the same request asks nothing.
    await prepareTravel(facts, [win('11:00', '12:00')], router);
    expect(router.asked).toHaveLength(1);
    expect(facts.travel!.book.calls).toBe(1);
  });

  it('stops asking once the provider is down, and every unanswered leg is unknown', async () => {
    const router = new FakeRouter({}, 'down');
    const ids = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const facts = data({
      resources: Object.fromEntries(ids.map((id, i) => [id, mobile({ neighbours: [{ workItemId: `p${i}`, occupies: win('09:00', '10:00'), place: { locationId: `L${i}`, point: { latitude: 10 + i, longitude: 10 + i } } }] })])),
    });
    await prepareTravel(facts, [win('11:00', '12:00')], { name: 'fake', route: (request) => router.route({ ...request, origin: POINTS.A, destination: POINTS.B }) });
    expect(facts.travel!.book.halted).toBe(true);
    expect(facts.travel!.book.calls).toBeLessThan(20);
    expect(judgeInterval(facts, win('11:00', '12:00')).travel.every((t) => t.state === 'unknown')).toBe(true);
  });

  it('routes only resources that are eligible, open and free — never the ones already ruled out', async () => {
    const router = new FakeRouter({});
    const ids = Array.from({ length: 80 }, (_, i) => `r${i}`);
    const place_ = (i: number): Place => ({ locationId: `L${i}`, point: { latitude: 10 + i, longitude: 10 + i } });
    const resources = Object.fromEntries(ids.map((id, i) => [id, mobile({ neighbours: [{ workItemId: `p${i}`, occupies: win('09:00', '10:00'), place: place_(i) }] })]));
    // 30 are eligible for nothing, 20 are not working, 10 are booked: 20 remain.
    const facts = data({
      resources,
      demands: [
        { requirementId: 'person', position: 0, quantity: 2, eligible: ids.slice(30) },
        { requirementId: 'vehicle', position: 1, quantity: 1, eligible: ids.slice(40, 70) },
      ],
      open: Object.fromEntries(ids.slice(30, 50).map((id) => [id, [] as Window[]])),
    });
    for (const id of ids.slice(50, 60)) facts.committed.set(id, [win('10:30', '12:30')]);

    const seen: string[] = [];
    const counting: RoutingProvider = {
      name: 'fake',
      route: async (request) => {
        seen.push(`${request.origin.latitude}`);
        return { distanceMeters: 1000, durationSeconds: 60, provider: 'fake', calculatedAt: '2027-04-01T00:00:00.000Z' };
      },
    };
    await prepareTravel(facts, [win('11:00', '12:00')], counting);
    // r60..r79 are eligible, open and free. Nobody else was routed.
    expect(seen.sort()).toEqual(ids.slice(60).map((_, i) => `${10 + 60 + i}`).sort());
    expect(judgeInterval(facts, win('11:00', '12:00')).feasible).toBe(true);
  });
});

describe('slots for a range', () => {
  const range = win('08:00', '18:00');

  it('removes a slot a free resource cannot reach in time, and keeps one it can', async () => {
    // Alex finishes at A at 10:00. B is 45 minutes away: 10:30 is too early, 11:00 is fine.
    const router = new FakeRouter({ 'A>B': 45 });
    const facts = data({
      resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) },
      unknown: 'exclude',
    });
    facts.committed.set('alex', [win('09:00', '10:00')]);

    const raw = (await feasibleSlotsWithTravel(data({ resources: { alex: { mode: null, base: null, neighbours: [] } } }), { range, durationMinutes: 60, stepMinutes: 30 }, router)).map((s) => s.startsAt);
    expect(raw).toContain(at('10:00'));

    const slots = (await feasibleSlotsWithTravel(facts, { range, durationMinutes: 60, stepMinutes: 30 }, router)).map((s) => s.startsAt);
    expect(slots).not.toContain(at('10:00'));
    expect(slots).not.toContain(at('10:30'));
    expect(slots).toContain(at('11:00'));
    // Whatever the router was asked, it was asked about this one pair, once.
    expect(router.asked.filter((pair) => pair === 'A>B')).toHaveLength(1);
  });

  it('offers nothing a visitor could not be told is reachable when the router is down', async () => {
    const facts = data({
      resources: { alex: mobile({ neighbours: [neighbour('prev', '09:00', '10:00', 'A')] }) },
      unknown: 'exclude',
    });
    facts.committed.set('alex', [win('09:00', '10:00')]);
    const slots = await feasibleSlotsWithTravel(facts, { range, durationMinutes: 60, stepMinutes: 30 }, new FakeRouter({}, 'down'));
    expect(slots).toEqual([]);
  });
});

describe('a call the router cannot place', () => {
  it('leaves an invalid pair as a fact about that pair, not an outage', async () => {
    const book = newRouteBook();
    const provider: RoutingProvider = {
      name: 'fake',
      route: async () => {
        throw new RoutingError('invalid_coordinates', 'bad');
      },
    };
    await resolveRoutes(book, provider, [{ from: POINTS.A, to: POINTS.B }]);
    expect(book.halted).toBe(false);
    expect([...book.outcomes.values()]).toEqual([{ ok: false, failure: 'invalid_coordinates' }]);
  });
});
