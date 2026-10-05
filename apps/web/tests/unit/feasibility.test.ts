import { describe, expect, it } from 'vitest';
import {
  evaluateAssignedResources,
  evaluateFeasibility,
  feasibleSlots,
  judgeInterval,
  type Demand,
  type FeasibilityData,
  type ResourceProblem,
  type ResourceState,
} from '@/lib/domain/scheduling/feasibility';
import type { Window } from '@/lib/domain/scheduling/window';

const INTERVAL: Window = { startsAt: '2027-04-06T10:00:00.000Z', endsAt: '2027-04-06T11:00:00.000Z' };

/** Resources in rank order, each with what is wrong with it in the interval (or null). */
function states(entries: [string, ResourceProblem | null][]): Map<string, ResourceState> {
  return new Map(entries.map(([id, problem], rank) => [id, { id, rank, problem }]));
}

const demand = (requirementId: string, position: number, quantity: number, eligible: string[]): Demand => ({
  requirementId,
  position,
  quantity,
  eligible,
});

describe('evaluateFeasibility', () => {
  it('is feasible when the one required resource is eligible, open and free', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex'])],
      states: states([['alex', null]]),
    });
    expect(result.feasible).toBe(true);
    expect(result.combination).toEqual([{ requirementId: 'person', resourceId: 'alex' }]);
    expect(result.reasons).toEqual([]);
  });

  it('treats a type that needs nothing as feasible with an empty combination', () => {
    const result = evaluateFeasibility({ interval: INTERVAL, demands: [], states: states([]) });
    expect(result.feasible).toBe(true);
    expect(result.combination).toEqual([]);
  });

  it('says there is no eligible resource when nobody could do the work, not that nobody is free', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('vehicle', 0, 1, [])],
      states: states([['van', null]]),
    });
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([{ code: 'no_eligible_resource', requirementId: 'vehicle' }]);
  });

  it('says there are too few eligible resources when the quantity cannot be met by anyone', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('crew', 0, 2, ['alex'])],
      states: states([['alex', null]]),
    });
    expect(result.reasons).toEqual([
      { code: 'insufficient_eligible_resources', requirementId: 'crew', required: 2, eligible: 1 },
    ]);
  });

  it('names working hours, time off and bookings as different reasons', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van'])],
      states: states([
        ['alex', 'not_working'],
        ['van', 'unavailable'],
      ]),
    });
    expect(result.reasons).toEqual([
      { code: 'resource_not_working', requirementId: 'person', resourceId: 'alex' },
      { code: 'resource_unavailable', requirementId: 'vehicle', resourceId: 'van' },
    ]);

    const booked = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('vehicle', 0, 1, ['van1', 'van2'])],
      states: states([
        ['van1', 'committed'],
        ['van2', 'committed'],
      ]),
    });
    expect(booked.reasons).toEqual([
      { code: 'resource_already_committed', requirementId: 'vehicle', resourceId: 'van1' },
      { code: 'resource_already_committed', requirementId: 'vehicle', resourceId: 'van2' },
      { code: 'insufficient_free_resources', requirementId: 'vehicle', required: 1, eligible: 2, open: 2, free: 0 },
    ]);
  });

  it('reports the business being closed before anything about resources', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex'])],
      states: states([['alex', 'committed']]),
      outsideOrganizationHours: true,
    });
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual([{ code: 'outside_organization_hours' }]);
  });

  it('needs every requirement, not any: person and vehicle', () => {
    const both = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van'])],
      states: states([
        ['alex', null],
        ['van', null],
      ]),
    });
    expect(both.combination).toEqual([
      { requirementId: 'person', resourceId: 'alex' },
      { requirementId: 'vehicle', resourceId: 'van' },
    ]);

    const noVan = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van'])],
      states: states([
        ['alex', null],
        ['van', 'committed'],
      ]),
    });
    expect(noVan.feasible).toBe(false);
    expect(noVan.combination).toBeNull();
    expect(noVan.requirements.find((entry) => entry.requirementId === 'person')!.satisfied).toBe(true);
    expect(noVan.requirements.find((entry) => entry.requirementId === 'vehicle')!.missingQuantity).toBe(1);
  });

  it('expands a quantity into distinct slots and never counts one resource twice', () => {
    const one = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('crew', 0, 2, ['alex', 'jo'])],
      states: states([
        ['alex', null],
        ['jo', 'committed'],
      ]),
    });
    expect(one.feasible).toBe(false);
    expect(one.requirements[0].missingQuantity).toBe(1);

    const two = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('crew', 0, 2, ['alex', 'jo'])],
      states: states([
        ['alex', null],
        ['jo', null],
      ]),
    });
    expect(two.combination!.map((entry) => entry.resourceId)).toEqual(['alex', 'jo']);
  });

  it('finds the matching a greedy one misses: Jo→A, Alex→B', () => {
    // A: Alex or Jo.  B: Alex only. A greedy first-come match gives A to Alex and strands B.
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('A', 0, 1, ['alex', 'jo']), demand('B', 1, 1, ['alex'])],
      states: states([
        ['alex', null],
        ['jo', null],
      ]),
    });
    expect(result.feasible).toBe(true);
    expect(result.combination).toEqual([
      { requirementId: 'A', resourceId: 'jo' },
      { requirementId: 'B', resourceId: 'alex' },
    ]);
  });

  it('explains requirements that compete for the same person', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('A', 0, 1, ['alex']), demand('B', 1, 1, ['alex'])],
      states: states([['alex', null]]),
    });
    expect(result.feasible).toBe(false);
    // Each alone has one free eligible resource; together they want the same one.
    expect(result.requirements.every((entry) => entry.freeResourceIds.length === 1)).toBe(true);
    expect(result.reasons).toEqual([{ code: 'requirements_compete_for_same_resources', requirementIds: ['B'] }]);
  });

  it('is stable: the same facts give the same combination whatever order they arrive in', () => {
    const base = {
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex', 'jo']), demand('vehicle', 1, 1, ['van1', 'van2'])],
      states: states([
        ['alex', null],
        ['jo', null],
        ['van1', null],
        ['van2', null],
      ]),
    };
    const first = evaluateFeasibility(base);
    const shuffled = evaluateFeasibility({
      ...base,
      demands: [...base.demands].reverse(),
      states: new Map([...base.states].reverse()),
    });
    expect(shuffled.combination).toEqual(first.combination);
    expect(first.combination).toEqual([
      { requirementId: 'person', resourceId: 'alex' },
      { requirementId: 'vehicle', resourceId: 'van1' },
    ]);
  });

  it('prefers the resources it is asked to, and only when they still work', () => {
    const demands = [demand('vehicle', 0, 1, ['van1', 'van2'])];
    const free = states([
      ['van1', null],
      ['van2', null],
    ]);
    expect(evaluateFeasibility({ interval: INTERVAL, demands, states: free, prefer: ['van2'] }).combination).toEqual([
      { requirementId: 'vehicle', resourceId: 'van2' },
    ]);

    const busy = states([
      ['van1', null],
      ['van2', 'committed'],
    ]);
    expect(evaluateFeasibility({ interval: INTERVAL, demands, states: busy, prefer: ['van2'] }).combination).toEqual([
      { requirementId: 'vehicle', resourceId: 'van1' },
    ]);
  });

  it('suggests the minimum — it never adds resources nobody needs', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex'])],
      states: states([
        ['alex', null],
        ['jo', null],
        ['van', null],
      ]),
    });
    expect(result.combination).toHaveLength(1);
  });
});

describe('evaluateAssignedResources', () => {
  it('fails an exact set when an extra resource beyond the requirements cannot be there', () => {
    const check = evaluateAssignedResources({
      demands: [demand('person', 0, 1, ['alex'])],
      states: states([
        ['alex', null],
        ['van', 'unavailable'],
      ]),
      resourceIds: ['alex', 'van'],
    });
    expect(check.requirementsMet).toBe(true);
    expect(check.allAvailable).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.resources).toEqual([
      { resourceId: 'alex', problem: null },
      { resourceId: 'van', problem: 'unavailable' },
    ]);
  });

  it('keeps covering the requirements apart from being available: a partly staffed job is allowed', () => {
    const check = evaluateAssignedResources({
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van'])],
      states: states([
        ['alex', null],
        ['van', null],
      ]),
      resourceIds: ['alex'],
    });
    expect(check.allAvailable).toBe(true);
    expect(check.requirementsMet).toBe(false);
    expect(check.requirements.find((entry) => entry.requirementId === 'vehicle')!.missingQuantity).toBe(1);
  });

  it('does not let one resource fill two positions', () => {
    const check = evaluateAssignedResources({
      demands: [demand('A', 0, 1, ['alex']), demand('B', 1, 1, ['alex'])],
      states: states([['alex', null]]),
      resourceIds: ['alex'],
    });
    expect(check.requirementsMet).toBe(false);
  });

  it('is trivially met when nothing is required, yet still checks who was chosen', () => {
    const check = evaluateAssignedResources({
      demands: [],
      states: states([['van', 'committed']]),
      resourceIds: ['van'],
    });
    expect(check.requirementsMet).toBe(true);
    expect(check.allAvailable).toBe(false);
  });
});

describe('at scale, by matching and never by enumerating combinations', () => {
  it('handles 100 resources across several requirements, and a quantity of 50', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `r${String(i).padStart(3, '0')}`);
    const demands = [
      demand('a', 0, 10, ids.slice(0, 40)),
      demand('b', 1, 10, ids.slice(20, 70)),
      demand('c', 2, 10, ids.slice(60, 100)),
      demand('d', 3, 50, ids),
    ];
    const started = performance.now();
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands,
      states: states(ids.map((id) => [id, null] as [string, null])),
    });
    const elapsed = performance.now() - started;

    // 80 slots, 100 resources: 100!/(20!) combinations exist; any enumeration would never finish.
    expect(result.feasible).toBe(true);
    expect(new Set(result.combination!.map((entry) => entry.resourceId)).size).toBe(80);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('proves infeasibility when 100 resources cannot cover 101 slots', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `r${i}`);
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('a', 0, 50, ids), demand('b', 1, 51, ids)],
      states: states(ids.map((id) => [id, null] as [string, null])),
    });
    expect(result.feasible).toBe(false);
  });
});

describe('feasibleSlots', () => {
  const at = (hh: string) => `2027-04-06T${hh}:00.000Z`;
  const win = (from: string, to: string): Window => ({ startsAt: at(from), endsAt: at(to) });

  function data(overrides: Partial<FeasibilityData>): FeasibilityData {
    return {
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van'])],
      ranks: new Map([
        ['alex', 0],
        ['van', 1],
      ]),
      open: new Map([
        ['alex', [win('09:00', '17:00')]],
        ['van', [win('08:00', '16:00')]],
      ]),
      committed: new Map(),
      exceptions: new Map(),
      organizationHours: null,
      ...overrides,
    };
  }

  it('offers an interval only when the whole set exists — one resource closing removes the slot', () => {
    const slots = feasibleSlots(data({}), { range: win('00:00', '23:59'), durationMinutes: 60, stepMinutes: 60 });
    // Alex opens at nine and the van closes at four: nine to four, and nothing outside either.
    expect(slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00']);
  });

  it('removes slots a resource is committed through, and offers again after the booking ends', () => {
    const slots = feasibleSlots(data({ committed: new Map([['van', [win('10:00', '11:30')]]]) }), {
      range: win('00:00', '23:59'),
      durationMinutes: 60,
      stepMinutes: 60,
    });
    const starts = slots.map((slot) => slot.startsAt.slice(11, 16));
    expect(starts).not.toContain('10:00');
    expect(starts).not.toContain('11:00');
    expect(starts).toContain('09:00');
    expect(starts).toContain('11:30');
  });

  it('keeps duration and step apart', () => {
    const slots = feasibleSlots(data({}), { range: win('09:00', '12:00'), durationMinutes: 60, stepMinutes: 30 });
    expect(slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('judges the same interval the same way the slot list does', () => {
    const facts = data({ committed: new Map([['alex', [win('10:00', '11:00')]]]) });
    const slots = feasibleSlots(facts, { range: win('00:00', '23:59'), durationMinutes: 60, stepMinutes: 60 });
    for (const slot of slots) expect(judgeInterval(facts, slot).feasible).toBe(true);
    expect(judgeInterval(facts, win('10:00', '11:00')).feasible).toBe(false);
  });
});
