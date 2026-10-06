// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeasibilityPanel } from '@/features/work/feasibility-panel';
import { WorkRequirementsSection } from '@/features/work/work-item-sections';
import { describeReason, viewFeasibility, type FeasibilityNames } from '@/features/scheduling/feasibility-text';
import { evaluateFeasibility, type Demand, type ResourceState } from '@/lib/domain/scheduling/feasibility';
import { runAxe } from '@/tests/support/axe';

/**
 * What the feasibility check says to an operator, and that it says it in words: the verdict, the
 * suggestion, and the reasons — from the domain's structured codes, never from stored prose.
 */

vi.mock('@/app/organizations/[organizationId]/work/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return { changeStatusAction: action, scheduleWorkItemAction: action, setWorkItemResourcesAction: action };
});
vi.mock('@/app/organizations/[organizationId]/work/feasibility-actions', () => ({ checkFeasibilityAction: vi.fn(async () => ({ error: null })) }));
vi.mock('@/app/organizations/[organizationId]/work/[workItemId]/actions', () => ({
  uploadWorkItemDocumentAction: vi.fn(),
  addChecklistItemAction: vi.fn(),
  toggleChecklistItemAction: vi.fn(),
}));

afterEach(cleanup);

const INTERVAL = { startsAt: '2027-04-06T10:00:00.000Z', endsAt: '2027-04-06T11:00:00.000Z' };
const names: FeasibilityNames = {
  resource: (id) => ({ alex: 'Alex', van1: 'Service Van 1', jo: 'Jo' })[id] ?? id,
  requirement: (id) => ({ person: 'Person · Tire service', vehicle: 'Vehicle · Mobile service', a: 'Person · A', b: 'Person · B' })[id ?? ''] ?? 'A resource',
};
const demand = (requirementId: string, position: number, quantity: number, eligible: string[]): Demand => ({ requirementId, position, quantity, eligible });
const states = (entries: [string, ResourceState['problem']][]) => new Map(entries.map(([id, problem], rank) => [id, { id, rank, problem }]));

describe('describeReason', () => {
  it('says each cause in words, from the code and the numbers', () => {
    expect(describeReason({ code: 'outside_organization_hours' }, names)).toBe('The business is closed then.');
    expect(describeReason({ code: 'resource_not_working', requirementId: 'person', resourceId: 'jo' }, names)).toBe('Jo is not working then.');
    expect(describeReason({ code: 'resource_unavailable', requirementId: 'vehicle', resourceId: 'van1' }, names)).toBe('Service Van 1 is unavailable then.');
    expect(describeReason({ code: 'resource_already_committed', requirementId: 'vehicle', resourceId: 'van1' }, names)).toBe('Service Van 1 is already booked then.');
    expect(describeReason({ code: 'insufficient_free_resources', requirementId: 'vehicle', required: 1, eligible: 2, open: 2, free: 0 }, names)).toBe(
      'Vehicle · Mobile service: 1 needed, 0 free (2 could do this).',
    );
    expect(describeReason({ code: 'requirements_compete_for_same_resources', requirementIds: ['a', 'b'] }, names)).toBe(
      'These needs compete for the same people: Person · A; Person · B.',
    );
  });
});

describe('FeasibilityPanel', () => {
  it('shows a feasible time with its suggestion, and offers it without applying it', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van1'])],
      states: states([['alex', null], ['van1', null]]),
    });
    const onUse = vi.fn();
    render(<FeasibilityPanel view={viewFeasibility(result, null, names)} onUseSuggested={onUse} />);

    expect(screen.getByRole('status')).toHaveTextContent('Feasible at that time.');
    expect(screen.getByText(/Alex, Service Van 1/)).toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use suggested resources' }));
    expect(onUse).toHaveBeenCalledWith(['alex', 'van1']);
  });

  it('says an infeasible time is infeasible in text, and why, with no suggestion to apply', async () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex']), demand('vehicle', 1, 1, ['van1'])],
      states: states([['alex', null], ['van1', 'committed']]),
    });
    const { container } = render(<FeasibilityPanel view={viewFeasibility(result, null, names)} onUseSuggested={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Not feasible at that time.');
    expect(screen.getByText('Service Van 1 is already booked then.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use suggested resources' })).not.toBeInTheDocument();
    expect(await runAxe(container)).toEqual([]);
  });

  it('explains requirements competing for one person', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('a', 0, 1, ['alex']), demand('b', 1, 1, ['alex'])],
      states: states([['alex', null]]),
    });
    render(<FeasibilityPanel view={viewFeasibility(result, null, names)} />);
    expect(screen.getByText(/compete for the same people/)).toBeInTheDocument();
  });

  it('reports the exact resources ticked: what is missing and who cannot be there', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 1, ['alex', 'jo']), demand('vehicle', 1, 1, ['van1'])],
      states: states([['alex', null], ['jo', 'not_working'], ['van1', null]]),
    });
    const selection = {
      allAvailable: false,
      allTravelFeasible: true,
      requirementsMet: false,
      ok: false,
      resources: [{ resourceId: 'jo', problem: 'not_working' as const }],
      requirements: [
        { requirementId: 'person', quantity: 1, eligibleResourceIds: [], openResourceIds: [], freeResourceIds: [], travelFeasibleResourceIds: [], matchedResourceIds: ['jo'], missingQuantity: 0, satisfied: true },
        { requirementId: 'vehicle', quantity: 1, eligibleResourceIds: [], openResourceIds: [], freeResourceIds: [], travelFeasibleResourceIds: [], matchedResourceIds: [], missingQuantity: 1, satisfied: false },
      ],
    };
    render(<FeasibilityPanel view={viewFeasibility(result, selection, names)} />);
    expect(screen.getByText('Jo is not working then.')).toBeInTheDocument();
    expect(screen.getByText('Vehicle · Mobile service requirement missing.')).toBeInTheDocument();
  });

  it('shows a quantity above one as missing the right number', () => {
    const result = evaluateFeasibility({
      interval: INTERVAL,
      demands: [demand('person', 0, 2, ['alex', 'jo'])],
      states: states([['alex', null], ['jo', 'committed']]),
    });
    render(<FeasibilityPanel view={viewFeasibility(result, null, names)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Not feasible at that time.');
  });
});

describe('WorkRequirementsSection suggestion', () => {
  const coverage = {
    satisfied: false,
    missingQuantity: 1,
    lines: [
      { requirementId: 'r1', text: 'Person · Tire service — Alex', met: true },
      { requirementId: 'r2', text: 'Vehicle · Mobile service — missing 1', met: false },
    ],
    extra: [],
    shortfall: 'Vehicle missing',
  };

  it('offers what is available at the job’s own time, and applies nothing by itself', () => {
    render(
      <WorkRequirementsSection
        coverage={coverage}
        suggestion={{ names: ['Service Van 1'], resourceIds: ['alex', 'van1'] }}
        organizationId="org"
        workItemId="job"
      />,
    );
    expect(screen.getByText(/Available at this time:/)).toBeInTheDocument();
    expect(screen.getByText('Service Van 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign suggested resources' })).toBeInTheDocument();
  });

  it('offers nothing when no complete set is free', () => {
    render(<WorkRequirementsSection coverage={coverage} suggestion={null} organizationId="org" workItemId="job" />);
    expect(screen.queryByRole('button', { name: 'Assign suggested resources' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not fully staffed');
  });
});
