// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import { AssignResourcesForm, ScheduleWorkItemForm } from '@/features/work/work-operations-forms';
import { runAxe } from '@/tests/support/axe';

/**
 * Who takes part in a job: a labelled group of real checkboxes, ticked from what the job has now,
 * with nothing ticked a valid answer. The server actions are replaced — under test is what the
 * forms offer and announce.
 */

vi.mock('@/app/organizations/[organizationId]/work/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return {
    changeStatusAction: action,
    scheduleWorkItemAction: action,
    setWorkItemResourcesAction: action,
  };
});

afterEach(cleanup);

const resources = [
  { id: 'alex', label: 'Alex' },
  { id: 'van', label: 'Service Van 1' },
  { id: 'machine', label: 'Tire Machine' },
];

describe('the resource checklist', () => {
  it('is a labelled group with one checkbox per resource, ticked from what the job has', () => {
    render(<ResourceChecklist legend="Resources" options={resources} selected={['alex', 'van']} />);
    const group = screen.getByRole('group', { name: 'Resources' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => [box.parentElement?.textContent, box.checked])).toEqual([
      ['Alex', true],
      ['Service Van 1', true],
      ['Tire Machine', false],
    ]);
  });

  it('is operable from the keyboard and submits every ticked id under one name', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <ResourceChecklist legend="Resources" options={resources} />
      </form>,
    );
    await user.tab();
    await user.keyboard(' ');
    await user.tab();
    await user.tab();
    await user.keyboard(' ');
    const form = container.querySelector('form')!;
    expect(new FormData(form).getAll('resourceIds')).toEqual(['alex', 'machine']);
  });

  it('says there is nothing to choose when the business has no resources', () => {
    render(<ResourceChecklist legend="Resources" options={[]} />);
    expect(screen.getByText(/No resources yet/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ResourceChecklist legend="Resources" options={resources} selected={['alex']} hint="Everyone ticked takes part." />);
    expect(await runAxe(container)).toEqual([]);
  });
});

describe('scheduling and assigning', () => {
  it('replaces the single "Assign to" select with the checklist, starting from who is on the job', () => {
    render(<ScheduleWorkItemForm organizationId="org" workItemId="w1" resources={resources} assigned={['van']} scheduled />);
    expect(screen.queryByLabelText('Assign to')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Service Van 1' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Alex' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Tick none for work nobody is on yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeTruthy();
  });

  it('lets who is on a job be saved on its own, without a time', () => {
    render(<AssignResourcesForm organizationId="org" workItemId="w1" resources={resources} assigned={['alex']} />);
    expect(screen.getByRole('button', { name: 'Save resources' })).toBeTruthy();
    expect(screen.queryByLabelText('Starts')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Alex' }) as HTMLInputElement).checked).toBe(true);
  });
});
