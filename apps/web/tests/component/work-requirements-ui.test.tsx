// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import { ResourceRequirementsEditor } from '@/features/work/configuration/resource-requirements';
import { WorkRequirementsSection } from '@/features/work/work-item-sections';
import { runAxe } from '@/tests/support/axe';
import type { ResourceRequirement } from '@/lib/domain/work-items/requirements';
import { fieldValue } from '../support/select-field';

/**
 * What a business sees when it says what a kind of work needs, and what a job says back about it.
 * Server actions are replaced: under test is what the forms offer and announce.
 */

vi.mock('@/features/work/configuration/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return { createRequirementAction: action, updateRequirementAction: action, deleteRequirementAction: action };
});
vi.mock('@/app/organizations/[organizationId]/work/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return { changeStatusAction: action, scheduleWorkItemAction: action, setWorkItemResourcesAction: action };
});
vi.mock('@/app/organizations/[organizationId]/work/[workItemId]/actions', () => ({
  uploadWorkItemDocumentAction: vi.fn(),
  addChecklistItemAction: vi.fn(),
  toggleChecklistItemAction: vi.fn(),
}));

afterEach(cleanup);

const capabilities = [
  { id: 'tire', name: 'Tire service', archived: false },
  { id: 'mobile', name: 'Mobile service', archived: false },
];
const requirement = (over: Partial<ResourceRequirement> = {}): ResourceRequirement => ({
  id: 'r1',
  typeId: 't1',
  resourceClass: 'person',
  quantity: 2,
  position: 0,
  capabilities: [capabilities[0]],
  ...over,
});

describe('the requirement editor', () => {
  const props = { organizationId: 'org', typeId: 't1', typeName: 'Mobile Tire Change', capabilities, mayConfigure: true };

  it('asks for a number, a kind and capabilities, each with a real label', () => {
    render(<ResourceRequirementsEditor {...props} requirements={[requirement()]} />);
    const form = screen.getByRole('form', { name: 'Requirement: 2 × Person' });
    const quantity = within(form).getByLabelText('Number needed') as HTMLInputElement;
    expect([quantity.min, quantity.max, quantity.required, quantity.value]).toEqual(['1', '50', true, '2']);
    expect(fieldValue(within(form).getByLabelText('Kind of resource'))).toBe('person');
    const group = within(form).getByRole('group', { name: 'Must have all of' });
    expect((within(group).getByRole('checkbox', { name: 'Tire service' }) as HTMLInputElement).checked).toBe(true);
    expect((within(group).getByRole('checkbox', { name: 'Mobile service' }) as HTMLInputElement).checked).toBe(false);
  });

  it('adds a requirement with no kind chosen, and names each removal for what it removes', () => {
    render(<ResourceRequirementsEditor {...props} requirements={[requirement()]} />);
    expect(screen.getByRole('button', { name: 'Remove requirement 2 × Person' })).toBeTruthy();
    const add = screen.getByRole('form', { name: 'Requirement: new requirement' });
    expect(fieldValue(within(add).getByLabelText('Kind of resource'))).toBe('');
    expect(within(add).getByRole('button', { name: 'Add requirement' })).toBeTruthy();
  });

  it('keeps an archived capability the requirement still names, and says so', () => {
    render(
      <ResourceRequirementsEditor
        {...props}
        capabilities={[capabilities[1]]}
        requirements={[requirement({ capabilities: [{ id: 'old', name: 'Old skill', archived: true }] })]}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Old skill (archived)' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('is read-only for somebody who may not configure', () => {
    render(<ResourceRequirementsEditor {...props} mayConfigure={false} requirements={[requirement()]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect((screen.getByLabelText('Number needed') as HTMLInputElement).disabled).toBe(true);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ResourceRequirementsEditor {...props} requirements={[requirement()]} />);
    expect(await runAxe(container)).toEqual([]);
  });
});

describe('the picker, grouped by what the work needs', () => {
  it('shows each requirement with its eligible resources once, then the additional ones', () => {
    render(
      <ResourceChecklist
        legend="Resources"
        options={[
          { id: 'alex', label: 'Alex' },
          { id: 'jo', label: 'Jo' },
          { id: 'van', label: 'Service Van 1' },
        ]}
        selected={['alex']}
        groups={[
          { key: 'a', title: 'Person · Tire service', hint: '1 required', resourceIds: ['alex'] },
          { key: 'b', title: 'Vehicle · Mobile service', hint: '1 required', resourceIds: ['van'] },
        ]}
        additionalIds={['jo']}
      />,
    );
    const people = screen.getByRole('group', { name: 'Person · Tire service, 1 required' });
    expect(within(people).getAllByRole('checkbox')).toHaveLength(1);
    expect((within(people).getByRole('checkbox', { name: 'Alex' }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole('group', { name: 'Additional resources' })).getByRole('checkbox', { name: 'Jo' })).toBeTruthy();
    // Every box submits under one name: the grouping is for the eye, the assignment is one set.
    expect(new Set(screen.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).name))).toEqual(new Set(['resourceIds']));
  });

  it('says plainly when nobody can fill a role', () => {
    render(
      <ResourceChecklist
        legend="Resources"
        options={[{ id: 'jo', label: 'Jo' }]}
        groups={[{ key: 'a', title: 'Vehicle', hint: '1 required', resourceIds: [] }]}
        additionalIds={['jo']}
      />,
    );
    expect(screen.getByText('No resource can do this yet.')).toBeTruthy();
  });
});

describe('what a job says about its needs', () => {
  it('names what is missing in words, with a mark that is only decoration', () => {
    render(
      <WorkRequirementsSection
        coverage={{
          satisfied: false,
          missingQuantity: 1,
          shortfall: 'Vehicle missing',
          lines: [
            { requirementId: 'a', met: true, text: 'Person · Tire service — Alex' },
            { requirementId: 'b', met: false, text: 'Vehicle · Mobile service — missing 1' },
          ],
          extra: ['Jo'],
        }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Not fully staffed — Vehicle missing.');
    expect(screen.getByText(/Missing:/).textContent).toBe('Missing: ');
    expect(screen.getByText('Also assigned: Jo.')).toBeTruthy();
  });

  it('says everything is covered, and draws nothing for a type that needs nothing', () => {
    const { container, rerender } = render(
      <WorkRequirementsSection
        coverage={{ satisfied: true, missingQuantity: 0, shortfall: null, lines: [{ requirementId: 'a', met: true, text: 'Person — Alex' }], extra: [] }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Everything this kind of work needs is assigned.');
    rerender(<WorkRequirementsSection coverage={null} />);
    expect(container.textContent).toBe('');
  });
});
