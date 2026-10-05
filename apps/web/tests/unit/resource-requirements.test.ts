import { describe, expect, it } from 'vitest';
import type { Resource } from '@/lib/domain/resources/resources';
import { RESOURCE_CLASS_LABELS, type ResourceClass } from '@/lib/domain/resources/resource-class';
import {
  coverageView,
  describeShortfall,
  evaluateRequirements,
  isEligible,
  requirementGroups,
  type ResourceRequirement,
} from '@/lib/domain/work-items/requirements';

/**
 * Requirements are a minimum need — a class, a quantity and capabilities (all of them) — and a job's
 * coverage is derived by matching assigned resources to required *slots*. The cases that matter are
 * the ones a naive count gets wrong: one person cannot fill two positions, and a greedy match can
 * spend the only resource that can fill a hard slot on an easy one.
 */

const cap = (id: string) => ({ id, name: id.toUpperCase(), archived: false });

function resource(name: string, resourceClass: ResourceClass, capabilityIds: string[] = []): Resource {
  return {
    id: name.toLowerCase(),
    name,
    resourceClass,
    capabilities: capabilityIds.map(cap),
    custom: {},
    createdAt: '2027-01-01T00:00:00Z',
    member: null,
  };
}

function need(id: string, resourceClass: ResourceClass, quantity: number, capabilityIds: string[] = [], position = 0): ResourceRequirement {
  return { id, typeId: 't', resourceClass, quantity, position, capabilities: capabilityIds.map(cap) };
}

describe('eligibility', () => {
  it('needs the class, always', () => {
    const requirement = need('r', 'person', 1);
    expect(isEligible(resource('Alex', 'person'), requirement)).toBe(true);
    expect(isEligible(resource('Van', 'vehicle'), requirement)).toBe(false);
  });

  it('with no capabilities named, the class alone is enough', () => {
    expect(isEligible(resource('Jo', 'person', ['oil']), need('r', 'person', 1))).toBe(true);
  });

  it('needs every capability named — all of them, never any', () => {
    const requirement = need('r', 'person', 1, ['tire', 'heavy']);
    expect(isEligible(resource('Alex', 'person', ['tire', 'heavy', 'oil']), requirement)).toBe(true);
    expect(isEligible(resource('Jo', 'person', ['tire']), requirement)).toBe(false);
    // A capability held by something of the wrong class does not make it eligible.
    expect(isEligible(resource('Van', 'vehicle', ['tire', 'heavy']), requirement)).toBe(false);
  });
});

describe('coverage', () => {
  it('counts quantity: 2 × Person is satisfied by two eligible people and short by one with one', () => {
    const requirement = need('r', 'person', 2, ['tire']);
    const two = evaluateRequirements([requirement], [resource('Alex', 'person', ['tire']), resource('Jo', 'person', ['tire'])]);
    expect(two.satisfied).toBe(true);

    const one = evaluateRequirements([requirement], [resource('Alex', 'person', ['tire'])]);
    expect(one.satisfied).toBe(false);
    expect(one.requirements[0].missingQuantity).toBe(1);
    expect(one.missingQuantity).toBe(1);
  });

  it('never lets one resource fill two required positions', () => {
    const tire = need('a', 'person', 1, ['tire'], 0);
    const oil = need('b', 'person', 1, ['oil'], 1);
    const alex = resource('Alex', 'person', ['tire', 'oil']);

    const alone = evaluateRequirements([tire, oil], [alex]);
    expect(alone.requirements.map((entry) => entry.satisfied)).toEqual([true, false]);
    expect(alone.missingQuantity).toBe(1);

    // Add somebody who can fill the other and both are met.
    const both = evaluateRequirements([tire, oil], [alex, resource('Jo', 'person', ['oil'])]);
    expect(both.satisfied).toBe(true);
  });

  it('finds the arrangement that covers everything when a greedy match would not', () => {
    // A needs capability A, B needs capability B. Alex has both, Jo only A. First-come would give Alex to
    // A and leave B uncovered; the best matching puts Jo on A and Alex on B.
    const a = need('a', 'person', 1, ['a'], 0);
    const b = need('b', 'person', 1, ['b'], 1);
    const alex = resource('Alex', 'person', ['a', 'b']);
    const jo = resource('Jo', 'person', ['a']);

    const result = evaluateRequirements([a, b], [alex, jo]);
    expect(result.satisfied).toBe(true);
    expect(result.requirements[0].matchedResources.map((r) => r.name)).toEqual(['Jo']);
    expect(result.requirements[1].matchedResources.map((r) => r.name)).toEqual(['Alex']);
  });

  it('treats extra assigned resources as valid additions, not mismatches', () => {
    const result = evaluateRequirements([need('r', 'person', 1)], [resource('Alex', 'person'), resource('Service Van', 'vehicle')]);
    expect(result.satisfied).toBe(true);
    expect(result.unmatchedAssignedResources.map((r) => r.name)).toEqual(['Service Van']);
  });

  it('a type that needs nothing is trivially satisfied, and unassigned work reports everything missing', () => {
    expect(evaluateRequirements([], []).satisfied).toBe(true);
    const empty = evaluateRequirements([need('r', 'person', 2), need('s', 'vehicle', 1, [], 1)], []);
    expect(empty.satisfied).toBe(false);
    expect(empty.missingQuantity).toBe(3);
  });

  it('is deterministic whatever order the inputs arrive in', () => {
    const requirements = [need('a', 'person', 1, ['a'], 0), need('b', 'person', 1, ['b'], 1), need('c', 'vehicle', 1, [], 2)];
    const people = [resource('Alex', 'person', ['a', 'b']), resource('Jo', 'person', ['a']), resource('Van', 'vehicle')];

    const names = (value: ReturnType<typeof evaluateRequirements>) =>
      value.requirements.map((entry) => entry.matchedResources.map((r) => r.name));
    const reference = names(evaluateRequirements(requirements, people));
    expect(names(evaluateRequirements([...requirements].reverse(), [...people].reverse()))).toEqual(reference);
    expect(names(evaluateRequirements(requirements, [people[2], people[0], people[1]]))).toEqual(reference);
  });
});

describe('what the screens read', () => {
  const labels = RESOURCE_CLASS_LABELS;

  it('groups eligible resources under the first requirement they could fill, each shown once', () => {
    const requirements = [need('a', 'person', 1, ['tire'], 0), need('b', 'vehicle', 1, ['mobile'], 1)];
    const resources = [
      resource('Alex', 'person', ['tire']),
      resource('Jo', 'person', ['oil']),
      resource('Van 1', 'vehicle', ['mobile']),
      resource('Van 2', 'vehicle'),
    ];
    const view = requirementGroups(requirements, resources, labels);

    expect(view.groups.map((group) => [group.title, group.resourceIds])).toEqual([
      ['Person · TIRE', ['alex']],
      ['Vehicle · MOBILE', ['van 1']],
    ]);
    expect(view.additionalIds).toEqual(['jo', 'van 2']);
  });

  it('describes coverage in words, not colour, and the short form names what is missing', () => {
    const requirements = [need('a', 'person', 1, ['tire'], 0), need('b', 'vehicle', 1, [], 1)];
    const view = coverageView(evaluateRequirements(requirements, [resource('Alex', 'person', ['tire'])]), labels);

    expect(view.satisfied).toBe(false);
    expect(view.lines.map((line) => line.text)).toEqual(['Person · TIRE — Alex', 'Vehicle — missing 1']);
    expect(view.shortfall).toBe('Vehicle missing');
    expect(describeShortfall(evaluateRequirements(requirements, []), labels)).toBe('2 resources missing');
  });
});
