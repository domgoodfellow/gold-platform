// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowWorkbench } from '@/features/automations/workbench/workflow-workbench';
import { ManagedAutomations } from '@/features/automations/managed/managed-automations';
import { projectRule } from '@/lib/domain/automation/workflow-graph';
import { MANAGED_AUTOMATIONS } from '@/lib/domain/automation/managed';
import type { AutomationRule, AutomationRun } from '@/lib/domain/automation/rules';

vi.mock('@/app/organizations/[organizationId]/automations/actions', () => {
  const ok = vi.fn(async () => ({ error: null }));
  return {
    addActionAction: ok, addToolActionAction: ok, addConditionAction: ok, removeConditionAction: ok,
    removeActionAction: ok, renameRuleAction: ok, setRuleEnabledAction: ok, deleteRuleAction: ok, createRuleAction: ok,
  };
});

// The drawer needs the workspace shell around it; what is under test is the workbench.
vi.mock('@/components/panels/page-drawer', () => ({
  PageDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageDrawerContent: ({ children }: { children: React.ReactNode }) => <div data-testid="drawer">{children}</div>,
  PageDrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  PageDrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  usePageDrawerUnsavedChanges: () => undefined,
}));

const rule = {
  id: 'rule-1',
  name: 'Confirm bookings',
  triggerKind: 'event',
  triggerEventAction: 'work_item.booked',
  triggerOffsetMinutes: null, triggerMetric: null, triggerComparison: null, triggerThreshold: null, triggerUnit: null, triggerCounterStep: null,
  enabled: false,
  conditions: [{ id: 'c-1', subjectField: 'title', operator: 'equals', value: 'Boiler' }],
  actions: [{ id: 'a-1', kind: 'change_status', statusId: 's-1', templateId: null, channel: null, shiftMinutes: null, typeId: null, toolLabel: null, toolArguments: null }],
  createdAt: '2026-11-01T00:00:00Z',
} as AutomationRule;
const statuses = [{ id: 's-1', label: 'Repair — Done' }];
const graph = projectRule(rule, { references: { statuses, templates: [], types: [], fields: [] } });
const runs: AutomationRun[] = [
  { id: 'run-1', ruleId: 'rule-1', ruleName: 'Confirm bookings', subjectType: 'work_item', subjectId: 'w-1', outcome: 'failed', detail: 'boom', occurredAt: '2026-11-16T10:00:00Z' },
];

function renderWorkbench(mayManage = true, shown = graph) {
  return render(
    <WorkflowWorkbench
      organizationId="org-1"
      rule={rule}
      graph={shown}
      statuses={statuses}
      templates={[]}
      types={[]}
      definitions={[]}
      recentRuns={runs}
      timezone="UTC"
      mayManage={mayManage}
    />,
  );
}

beforeEach(() => {
  // A phone: jsdom has no layout, and the workbench asks the same media query a browser would.
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe('WorkflowWorkbench on a phone', () => {
  it('shows the steps, not the canvas, and offers no view switch', () => {
    renderWorkbench();
    const steps = screen.getByRole('region', { name: 'Workflow canvas' });
    expect(within(steps).getByRole('button', { name: /Trigger.*Something happens/ })).toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: /Condition 1.*Title is Boiler/ })).toBeInTheDocument();
    expect(within(steps).getByRole('button', { name: /Action 1.*Repair — Done/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Add a step' })).toBeNull();
  });

  it('opens the chosen step full screen and returns to the steps', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    expect(screen.getByLabelText('Node inspector')).toHaveClass('hidden');
    await user.click(screen.getByRole('button', { name: /Condition 1/ }));
    const inspector = screen.getByLabelText('Node inspector');
    expect(inspector).not.toHaveClass('hidden');
    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toHaveClass('hidden');
    expect(within(inspector).getByRole('heading', { name: 'Condition 1 · Title is Boiler' })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Edit condition' })).toBeInTheDocument();
    await user.click(within(inspector).getByRole('button', { name: 'Back to steps' }));
    expect(screen.getByLabelText('Node inspector')).toHaveClass('hidden');
  });

  it('says the trigger is fixed rather than offering to edit it', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('button', { name: /Trigger/ }));
    const inspector = screen.getByLabelText('Node inspector');
    expect(within(inspector).getByText(/Fixed after creation/)).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('shows recent runs and problems under Checks', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole('button', { name: 'Checks' }));
    const inspector = screen.getByLabelText('Node inspector');
    expect(within(inspector).getByText('No problems found.')).toBeInTheDocument();
    expect(within(inspector).getByText('Failed')).toBeInTheDocument();
    expect(within(inspector).getByRole('link', { name: 'All runs' })).toHaveAttribute('href', '/organizations/org-1/automations/runs?when=all&rule=rule-1');
  });

  it('raises a step that points at something deleted, on the step and under Checks', async () => {
    const user = userEvent.setup();
    // The stage this action moves to has been deleted since the workflow was written.
    renderWorkbench(true, projectRule(rule, { references: { statuses: [], templates: [], types: [], fields: [] } }));
    await user.click(screen.getByRole('button', { name: /Action 1/ }));
    expect(within(screen.getByLabelText('Node inspector')).getByRole('alert')).toHaveTextContent('The stage this moves to no longer exists.');
    await user.click(screen.getByRole('button', { name: '1 to check' }));
    const found = within(screen.getByLabelText('Node inspector')).getByRole('list', { name: 'Checks found' });
    expect(within(found).getByRole('listitem')).toHaveTextContent('Error: The stage this moves to no longer exists.');
  });

  it('offers no change to a role that can only read', async () => {
    const user = userEvent.setup();
    renderWorkbench(false);
    expect(screen.queryByRole('button', { name: 'Add condition' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add action' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Action 1/ }));
    expect(screen.queryByRole('button', { name: 'Edit action' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('WorkflowWorkbench on a wide screen', () => {
  it('switches between canvas and steps with the shared toggle, keeping the address', async () => {
    window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: true, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = userEvent.setup();
    renderWorkbench(true);
    const view = await screen.findByRole('group', { name: 'View' });
    expect(view).toHaveAttribute('data-variant', 'segmented');
    expect(within(view).getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(view).getByRole('button', { name: 'Steps' }));
    expect(within(view).getByRole('button', { name: 'Steps' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toContain('view=list');
    expect(screen.getByRole('button', { name: /Condition 1: Title is Boiler/ })).toHaveAttribute('data-slot', 'selectable-card');
  });
});

describe('ManagedAutomations', () => {
  it('lists GildOps’ own work apart from workflows and says it cannot be edited', async () => {
    const user = userEvent.setup();
    render(<ManagedAutomations organizationId="org-1" entries={[MANAGED_AUTOMATIONS[0]]} />);
    expect(screen.getByRole('heading', { name: 'Managed by GildOps' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Inspect ${MANAGED_AUTOMATIONS[0].name}` }));
    const drawer = screen.getByTestId('drawer');
    expect(within(drawer).getByText(/cannot be edited here/)).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Message templates' })).toHaveAttribute('href', '/organizations/org-1/automations/messages');
  });
});
