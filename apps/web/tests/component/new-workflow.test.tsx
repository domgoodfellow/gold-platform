// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewWorkflow } from '@/features/automations/create/new-workflow';

const create = vi.hoisted(() => vi.fn());
vi.mock('@/app/organizations/[organizationId]/automations/actions', () => ({ createRuleAction: create }));

// The phone's step is in the address. Next's router follows pushState and Back; this stand-in does
// the same, so the steps are exercised as a browser would move between them.
vi.mock('next/navigation', async () => {
  const React = await import('react');
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History['pushState']>) => {
    push(...args);
    notify();
  };
  window.addEventListener('popstate', notify);
  return {
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => window.location.search,
      );
      return new URLSearchParams(search);
    },
  };
});

const wide = (matches: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
};
const form = () => screen.getByRole('form', { name: 'New workflow' });
// The phone's step bar carries its own Cancel; a wide screen shows only the one beside Create.
const cancel = () => within(screen.getByRole('region', { name: 'Name and create' })).getByRole('link', { name: 'Cancel' });
const choose = (name: RegExp) => userEvent.click(within(form()).getByRole('button', { name }));

beforeEach(() => {
  window.history.replaceState(null, '', '/organizations/org-1/automations/workflows/new');
  create.mockReset();
  wide(true);
});
afterEach(cleanup);

describe('New workflow on a wide screen', () => {
  it('is a page, not a drawer, with every trigger the runtime has and none it does not', () => {
    render(<NewWorkflow organizationId="org-1" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const choices = within(screen.getByRole('group', { name: 'What sets it off' })).getAllByRole('button');
    expect(choices.map((choice) => choice.querySelector('span')?.textContent)).toEqual([
      'Something happens',
      'Before a job starts',
      'Conditions at the job',
      'Machine counter',
    ]);
    expect(screen.queryByText(/webhook/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'Workflow structure' })).toHaveTextContent('Choose what sets it off.');
    expect(cancel()).toHaveAttribute('href', '/organizations/org-1/automations/workflows');
  });

  it('shows only the chosen trigger’s settings and keeps each trigger’s values when switching', async () => {
    const user = userEvent.setup();
    render(<NewWorkflow organizationId="org-1" />);
    await choose(/^Machine counter/);
    expect(screen.getByRole('button', { name: /^Machine counter/ })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('Every'), '250');
    await user.type(screen.getByLabelText('Unit'), 'hours');
    // The structure preview is the workbench's step list, drawn from the draft.
    const structure = screen.getByRole('region', { name: 'Workflow structure' });
    expect(within(structure).getByRole('button', { name: /Trigger: Machine counter/ })).toHaveTextContent('Every 250 hours on a machine');
    expect(structure).toHaveTextContent('A machine counter has no job to check.');

    await choose(/^Before a job starts/);
    expect(screen.queryByLabelText('Every')).toBeNull();
    expect(screen.getByLabelText('How long before')).toHaveValue(2);
    expect(within(structure).getByRole('button', { name: /Trigger: Before a job starts/ })).toHaveTextContent('2 hours before a job starts');

    await choose(/^Machine counter/);
    expect(screen.getByLabelText('Every')).toHaveValue(250);
    expect(screen.getByLabelText('Unit')).toHaveValue('hours');
  });

  it('says what is missing, keeps what was typed and sends nothing until it is complete', async () => {
    const user = userEvent.setup();
    render(<NewWorkflow organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'Create workflow' }));
    expect(screen.getByText('Choose what sets it off.', { selector: '#new-workflow-kind-error' })).toBeInTheDocument();
    expect(screen.getByText('Give the workflow a name.')).toBeInTheDocument();

    await choose(/^Machine counter/);
    await user.type(screen.getByLabelText('Name'), 'Service due');
    await user.type(screen.getByLabelText('Every'), '0');
    await user.click(screen.getByRole('button', { name: 'Create workflow' }));
    expect(screen.getByText('Enter a number above zero.')).toBeInTheDocument();
    expect(screen.getByText('Enter the unit the machine counts in.')).toBeInTheDocument();
    expect(screen.getByLabelText('Every')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveValue('Service due');
    expect(create).not.toHaveBeenCalled();

    // Switching to another trigger does not greet it with errors for fields not yet filled in.
    await choose(/^Something happens/);
    expect(screen.queryByText('Choose which moment.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create workflow' }));
    expect(screen.getByText('Choose which moment.')).toBeInTheDocument();
  });

  it('sends only the chosen trigger, keeps the draft when the server refuses, and submits once', async () => {
    const user = userEvent.setup();
    create.mockResolvedValueOnce({ error: 'This business already has a rule with that name.' });
    render(<NewWorkflow organizationId="org-1" />);
    await choose(/^Before a job starts/);
    await choose(/^Machine counter/);
    await user.type(screen.getByLabelText('Every'), '250');
    await user.type(screen.getByLabelText('Unit'), 'hours');
    await user.type(screen.getByLabelText('Name'), 'Service due');
    await user.click(screen.getByRole('button', { name: 'Create workflow' }));

    await screen.findByText('This business already has a rule with that name.');
    expect(Object.fromEntries(create.mock.calls[0][1] as FormData)).toEqual({
      organizationId: 'org-1',
      name: 'Service due',
      triggerKind: 'counter_threshold',
      triggerCounterStep: '250',
      triggerUnit: 'hours',
    });
    expect(screen.getByLabelText('Name')).toHaveValue('Service due');
    expect(screen.getByLabelText('Every')).toHaveValue(250);

    // A second attempt that has not answered yet cannot be sent twice.
    create.mockImplementation(() => new Promise(() => {}));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Service due again');
    await user.click(screen.getByRole('button', { name: 'Create workflow' }));
    const pending = await screen.findByRole('button', { name: 'Creating…' });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('asks before leaving a changed draft, and not an untouched one', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewWorkflow organizationId="org-1" />);
    await user.click(cancel());
    expect(confirm).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Name'), 'Half done');
    await user.click(cancel());
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave this editor and discard them?');
    confirm.mockRestore();
  });
});

describe('New workflow on a phone', () => {
  beforeEach(() => wide(false));

  it('moves through trigger, details and name one step at a time, with Back', async () => {
    const user = userEvent.setup();
    render(<NewWorkflow organizationId="org-1" />);
    const steps = screen.getByRole('navigation', { name: 'Steps' });
    expect(steps).toHaveTextContent('1 of 3');
    expect(screen.getByRole('region', { name: 'Workflow structure' })).toHaveClass('hidden');

    await user.click(within(steps).getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Choose what sets it off.', { selector: '#new-workflow-kind-error' })).toBeInTheDocument();

    await choose(/^Before a job starts/);
    await user.click(within(steps).getByRole('button', { name: /Next/ }));
    expect(window.location.search).toBe('?step=details');
    expect(steps).toHaveTextContent('2 of 3');
    expect(screen.getByRole('heading', { name: 'Before a job starts' })).toHaveFocus();
    expect(screen.getByRole('group', { name: 'What sets it off' })).toHaveClass('hidden');

    await user.click(within(steps).getByRole('button', { name: /Next/ }));
    expect(steps).toHaveTextContent('3 of 3');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Workflow structure' })).not.toHaveClass('hidden');

    await user.click(within(steps).getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(steps).toHaveTextContent('2 of 3'));
    expect(screen.getByLabelText('How long before')).toHaveValue(2);
  });
});
