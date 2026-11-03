// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddActionSheet } from '@/features/automations/rules/add-action-sheet';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import type { ToolChoice } from '@/lib/domain/integrations/tool-access';
import { chooseOption, optionLabels } from '../support/select-field';

vi.mock('@/app/organizations/[organizationId]/automations/actions', () => ({
  addActionAction: vi.fn(async () => ({ error: null })),
  addToolActionAction: vi.fn(async () => ({ error: null })),
}));

// The drawer needs the workspace shell around it; what is under test is what is inside it.
vi.mock('@/components/panels/page-drawer', () => ({
  PageDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageDrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageDrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  PageDrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

afterEach(cleanup);

const rule = { id: 'r1', name: 'Check contacts', triggerKind: 'event', actions: [], conditions: [] } as unknown as AutomationRule;
const choices: ToolChoice[] = [
  {
    connectionId: 'c1',
    connectorName: 'GitHub',
    accountLabel: 'acme',
    capabilities: [
      {
        key: 'github.issues.list',
        summary: 'Open issues of one repository',
        workspace: 'support',
        writes: false,
        resourceType: null,
        inputs: ['owner', 'repo', 'limit'],
        fields: [
          { name: 'owner', label: 'Repository owner', kind: 'text', required: true },
          { name: 'repo', label: 'Repository name', kind: 'text', required: true },
          { name: 'limit', label: 'How many to return (default 25)', kind: 'whole number', required: false },
        ],
      },
    ],
  },
];

function open(props: Partial<Parameters<typeof AddActionSheet>[0]> = {}) {
  render(<AddActionSheet organizationId="org" rule={rule} statuses={[]} templates={[]} types={[]} {...props} />);
  return userEvent.setup();
}

describe('using a connected tool from a rule', () => {
  it('is offered only when there is something to read', async () => {
    open({ toolChoices: choices });
    expect(await optionLabels(screen.getByLabelText('What to do'))).toContain('use a connected tool');
    cleanup();

    open({ toolChoices: [] });
    expect(await optionLabels(screen.getByLabelText('What to do'))).not.toContain('use a connected tool');
  });

  it('asks only what the chosen tool needs, in plain words, and says it only reads', async () => {
    open({ toolChoices: choices });
    await chooseOption(screen.getByLabelText('What to do'), 'run_tool');
    expect(screen.queryByLabelText(/Repository owner/)).not.toBeInTheDocument();

    await chooseOption(screen.getByLabelText('What to read'), 'c1|github.issues.list');
    expect(screen.getByLabelText('Repository owner')).toBeRequired();
    expect(screen.getByLabelText('Repository name')).toBeRequired();
    const limit = screen.getByLabelText(/How many to return \(default 25\) \(optional\)/);
    expect(limit).not.toBeRequired();
    expect(limit).toHaveAttribute('type', 'number');
    expect(screen.getByText(/It only reads; it changes nothing in the app, and what it read is not kept/)).toBeInTheDocument();
  });

  it('cannot be edited once added: it is removed and added again', async () => {
    const action = { id: 'a1', kind: 'run_tool', toolLabel: 'Open issues · GitHub', toolArguments: {}, statusId: null, templateId: null, channel: null, shiftMinutes: null, typeId: null } as AutomationRule['actions'][number];
    open({ toolChoices: choices, action });
    expect(screen.queryByRole('option', { name: 'use a connected tool' })).not.toBeInTheDocument();
  });
});
