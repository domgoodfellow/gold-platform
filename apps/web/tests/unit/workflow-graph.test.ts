import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, TRIGGER_KINDS, type AutomationRule } from '@/lib/domain/automation/rules';
import { projectRule } from '@/lib/domain/automation/workflow-graph';
import { WORKFLOW_NODE_TYPES, paletteFor } from '@/lib/domain/automation/workflow-nodes';
import { MANAGED_AUTOMATIONS, managedAutomationsFor } from '@/lib/domain/automation/managed';
import type { WorkflowReferences } from '@/lib/domain/automation/describe';

const references: WorkflowReferences = {
  statuses: [{ id: 's-done', label: 'Repair — Done' }],
  templates: [{ id: 't-1', name: 'Booked' }],
  types: [{ id: 'k-1', name: 'Repair' }],
  fields: [{ key: 'priority', label: 'Priority' }],
};

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Confirm bookings',
    triggerKind: 'event',
    triggerEventAction: 'work_item.booked',
    triggerOffsetMinutes: null,
    triggerMetric: null,
    triggerComparison: null,
    triggerThreshold: null,
    triggerUnit: null,
    triggerCounterStep: null,
    enabled: false,
    conditions: [
      { id: 'c-1', subjectField: 'title', operator: 'equals', value: 'Boiler' },
      { id: 'c-2', subjectField: 'custom.priority', operator: 'is_set', value: null },
    ],
    actions: [
      { id: 'a-1', kind: 'change_status', statusId: 's-done', templateId: null, channel: null, shiftMinutes: null, typeId: null, toolLabel: null, toolArguments: null },
      { id: 'a-2', kind: 'notify', statusId: null, templateId: 't-1', channel: 'email', shiftMinutes: null, typeId: null, toolLabel: null, toolArguments: null },
    ],
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('projectRule', () => {
  it('draws one node per stored row, in reading order, each pointing back at its row', () => {
    const graph = projectRule(rule(), { references });
    expect(graph.nodes.map((node) => [node.id, node.role, node.record.table, node.step])).toEqual([
      ['trigger', 'trigger', 'automation_rules', 1],
      ['c-1', 'condition', 'automation_conditions', 2],
      ['c-2', 'condition', 'automation_conditions', 3],
      ['a-1', 'action', 'automation_actions', 4],
      ['a-2', 'action', 'automation_actions', 5],
    ]);
    expect(graph.nodes[0].record.id).toBe('rule-1');
    expect(graph.source).toEqual({ ownership: 'organization', kind: 'automation_rule', ruleId: 'rule-1' });
  });

  it('computes edges from the runtime semantics: if, and, then — never a branch', () => {
    const graph = projectRule(rule(), { references });
    expect(graph.edges.map((edge) => `${edge.source}-${edge.kind}-${edge.target}`)).toEqual([
      'trigger-if-c-1',
      'c-1-and-c-2',
      'c-2-then-a-1',
      'a-1-then-a-2',
    ]);
    expect(graph.semantics).toMatchObject({ conditions: 'all', actions: 'in_order', branching: false, triggerEditable: false });
  });

  it('reads steps in the business’s words, not stored codes', () => {
    const graph = projectRule(rule(), { references });
    const summary = (id: string) => graph.nodes.find((node) => node.id === id)!.summary;
    const label = (id: string) => graph.nodes.find((node) => node.id === id)!.label;
    expect(summary('trigger')).toBe('When somebody books through the public page');
    // A condition's title is what it checks; there is no second line to repeat it.
    expect(label('c-1')).toBe('Title is Boiler');
    expect(summary('c-1')).toBe('');
    expect(label('c-2')).toBe('Priority has been filled in');

    // Each condition is titled by what it checks, so two conditions never share a title, and a
    // stage that has since been deleted is named as such rather than printed as its id.
    const checked = projectRule(
      rule({
        conditions: [
          { id: 'c-s', subjectField: 'status_id', operator: 'equals', value: 's-done' },
          { id: 'c-gone', subjectField: 'status_id', operator: 'not_equals', value: 's-deleted' },
        ],
      }),
      { references },
    );
    expect(checked.nodes.filter((node) => node.role === 'condition').map((node) => node.label)).toEqual([
      'Stage is Repair — Done',
      'Stage is not a removed stage',
    ]);
    expect(summary('a-1')).toBe('Repair — Done');
    expect(summary('a-2')).toBe("Booked · Email · the job's customer");
  });

  it('never offers to edit or remove the trigger, and never edits a connected tool in place', () => {
    const graph = projectRule(
      rule({
        actions: [
          { id: 'a-t', kind: 'run_tool', statusId: null, templateId: null, channel: null, shiftMinutes: null, typeId: null, toolLabel: 'List rows · Sheets', toolArguments: {} },
        ],
      }),
      { references },
    );
    expect(graph.nodes[0].operations).toEqual({ edit: false, remove: false });
    expect(graph.nodes.find((node) => node.id === 'a-t')!.operations).toEqual({ edit: false, remove: true });
  });

  it('marks a step whose stage, kind of work or message no longer exists', () => {
    const graph = projectRule(
      rule({
        actions: [
          { id: 'a-x', kind: 'create_work_item', statusId: 'gone', templateId: null, channel: null, shiftMinutes: null, typeId: 'gone', toolLabel: null, toolArguments: null },
          { id: 'a-y', kind: 'notify', statusId: null, templateId: 'gone', channel: 'email', shiftMinutes: null, typeId: null, toolLabel: null, toolArguments: null },
        ],
      }),
      { references },
    );
    expect(graph.nodes.find((node) => node.id === 'a-x')!.issues).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === 'a-y')!.issues).toHaveLength(1);
    expect(graph.issues.filter((issue) => issue.severity === 'error')).toHaveLength(3);
  });

  it('warns about a workflow with no action and carries review warnings through', () => {
    const graph = projectRule(rule({ actions: [] }), { references, warnings: ['No reading uses this unit.'] });
    expect(graph.issues.map((issue) => issue.message)).toEqual([
      'Does nothing until an action is added.',
      'No reading uses this unit.',
    ]);
  });

  it('says a counter workflow has no conditions to apply', () => {
    const graph = projectRule(
      rule({ triggerKind: 'counter_threshold', triggerEventAction: null, triggerCounterStep: 250, triggerUnit: 'hours', conditions: [] }),
      { references },
    );
    expect(graph.semantics.conditions).toBe('not_applicable');
    expect(graph.nodes[0].summary).toBe('Every 250 hours on a machine');
  });
});

describe('workflow node registry', () => {
  it('covers every trigger and action the rule runtime performs, and nothing executable beyond them', () => {
    const executable = WORKFLOW_NODE_TYPES.filter((entry) => entry.availability === 'executable').map((entry) => entry.type);
    expect(executable.sort()).toEqual(
      [
        ...TRIGGER_KINDS.map((entry) => `trigger.${entry.kind}`),
        'condition.job_field',
        ...ACTION_KINDS.map((entry) => `action.${entry.kind}`),
      ].sort(),
    );
  });

  it('keeps planned steps out of every palette and stores none of them', () => {
    const planned = WORKFLOW_NODE_TYPES.filter((entry) => entry.availability === 'planned');
    expect(planned.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['trigger.incoming_webhook', 'action.http_request', 'action.ai_agent', 'logic.branch']),
    );
    expect(planned.every((entry) => entry.storage === null)).toBe(true);
    for (const kind of TRIGGER_KINDS.map((entry) => entry.kind)) {
      for (const connectedTools of [true, false]) {
        const palette = paletteFor(kind, { connectedTools });
        expect(palette.every((entry) => entry.availability === 'executable')).toBe(true);
        expect(palette.some((entry) => entry.role === 'trigger' || entry.role === 'logic')).toBe(false);
      }
    }
  });

  it('applies the same limits as the rule commands', () => {
    expect(paletteFor('counter_threshold', { connectedTools: true }).map((entry) => entry.type)).toEqual(['action.create_work_item']);
    expect(paletteFor('event', { connectedTools: false }).map((entry) => entry.type)).not.toContain('action.run_tool');
    expect(paletteFor('event', { connectedTools: true }).map((entry) => entry.type)).toContain('action.run_tool');
    expect(paletteFor('event', { connectedTools: false })[0].type).toBe('condition.job_field');
  });
});

describe('managed automations', () => {
  it('lists only what the business has switched on, and never platform machinery', () => {
    const keys = (modules: string[]) => managedAutomationsFor(new Set(modules)).map((entry) => entry.key);
    expect(keys([])).toEqual(['service-update-emails']);
    expect(keys(['automations'])).toEqual(['workflow-messages', 'timed-workflow-checks', 'service-update-emails']);
    expect(keys(['automations', 'integrations'])).toHaveLength(MANAGED_AUTOMATIONS.length);
    for (const entry of MANAGED_AUTOMATIONS) {
      expect(entry.controls.length).toBeGreaterThan(0);
      expect(entry.controls.every((control) => !control.path.startsWith('/') && !control.path.startsWith('platform'))).toBe(true);
    }
  });
});
