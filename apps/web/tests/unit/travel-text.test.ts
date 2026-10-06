import { describe, expect, it } from 'vitest';
import { viewFeasibility } from '@/features/scheduling/feasibility-text';
import { evaluateFeasibility, type ResourceState } from '@/lib/domain/scheduling/feasibility';
import type { ResourceTravel } from '@/lib/domain/scheduling/travel';

/**
 * Travel in words. A journey must read the same without a map, an icon or a colour, with the numbers
 * in the sentence and the resource named in it, so a screen reader hears who and how long.
 */

const INTERVAL = { startsAt: '2027-04-06T10:45:00.000Z', endsAt: '2027-04-06T11:45:00.000Z' };
const names = { resource: (id: string) => ({ van: 'Service Van 1', alex: 'Alex' })[id] ?? id, requirement: () => 'Vehicle' };

function viewOf(travel: ResourceTravel, id = 'van') {
  const states = new Map<string, ResourceState>([[id, { id, rank: 0, problem: null, travel }]]);
  const result = evaluateFeasibility({
    interval: INTERVAL,
    demands: [{ requirementId: 'r', position: 0, quantity: 1, eligible: [id] }],
    states,
  });
  return viewFeasibility(result, null, names);
}

describe('travel, in sentences', () => {
  it('says how long a journey needs and how much the schedule leaves, naming the resource', () => {
    const view = viewOf({
      resourceId: 'van',
      state: 'infeasible',
      legs: [],
      reasons: [
        { code: 'travel_from_previous_too_long', resourceId: 'van', previousWorkItemId: 'w', availableSeconds: 20 * 60, requiredSeconds: 34 * 60, distanceMeters: 30000 },
      ],
    });
    expect(view.feasible).toBe(false);
    expect(view.reasons).toEqual(['Service Van 1 needs about 34 min from the previous job, but only 20 min are available.']);
  });

  it('rounds a trip up to a whole minute and never calls a real trip zero', () => {
    const view = viewOf({
      resourceId: 'van',
      state: 'infeasible',
      legs: [],
      reasons: [{ code: 'travel_to_next_too_long', resourceId: 'van', nextWorkItemId: 'w', availableSeconds: 61, requiredSeconds: 5, distanceMeters: 1 }],
    });
    expect(view.reasons).toEqual(['Service Van 1 needs about 1 min to reach its next job, but only 2 min are available.']);
  });

  it('lists the journeys a feasible time relies on, with what each leaves', () => {
    const view = viewOf({
      resourceId: 'van',
      state: 'ok',
      reasons: [],
      legs: [
        { kind: 'previous', fromLocationId: 'a', toLocationId: 'b', requiredSeconds: 18 * 60, availableSeconds: 30 * 60, distanceMeters: 12000, provider: 'x', calculatedAt: null, otherWorkItemId: 'w' },
        { kind: 'next', fromLocationId: 'b', toLocationId: 'c', requiredSeconds: 0, availableSeconds: 45 * 60, distanceMeters: 0, provider: null, calculatedAt: null, otherWorkItemId: 'n' },
      ],
    });
    expect(view.feasible).toBe(true);
    expect(view.travel).toEqual(['Service Van 1 — about 18 min from the previous job, 30 min available.', 'Service Van 1 — no travel to its next job.']);
  });

  it('keeps a doubt apart from a refusal: unverified travel is a warning and the time stays feasible', () => {
    const view = viewOf({
      resourceId: 'van',
      state: 'unknown',
      legs: [],
      reasons: [{ code: 'routing_unavailable', resourceId: 'van' }],
    });
    expect(view.feasible).toBe(true);
    expect(view.reasons).toEqual([]);
    expect(view.warnings).toEqual(['Travel time could not be verified for Service Van 1.']);
  });

  it('says where the doubt is: a job with no place, an origin nobody knows', () => {
    const origin = viewOf({ resourceId: 'van', state: 'unknown', legs: [], reasons: [{ code: 'travel_origin_unknown', resourceId: 'van' }] });
    expect(origin.warnings).toEqual(['Travel time could not be verified for Service Van 1: it has no earlier job and no base.']);

    const next = viewOf({ resourceId: 'van', state: 'unknown', legs: [], reasons: [{ code: 'travel_destination_unknown', resourceId: 'van', nextWorkItemId: 'n' }] });
    expect(next.warnings).toEqual(['Travel time could not be verified for Service Van 1: its next job has no location.']);
  });

  it('says a fixed resource cannot be somewhere else, and that no road is a fact', () => {
    const fixed = viewOf({ resourceId: 'van', state: 'infeasible', legs: [], reasons: [{ code: 'fixed_resource_wrong_location', resourceId: 'van' }] });
    expect(fixed.reasons).toEqual(['Service Van 1 stays at its base and cannot work at that place.']);

    const none = viewOf({ resourceId: 'van', state: 'infeasible', legs: [], reasons: [{ code: 'travel_route_not_found', resourceId: 'van', leg: 'previous' }] });
    expect(none.reasons).toEqual(['There is no drivable route for Service Van 1 from the previous job.']);
  });
});
