import type { AutomationRule } from './rules';
import {
  describeAction,
  describeCondition,
  describeTrigger,
  type WorkflowReferences,
} from './describe';
import { ACTION_LABELS, nodeType, type WorkflowNodeRole } from './workflow-nodes';

/**
 * A rule, drawn as a graph.
 *
 * **A projection, never a second copy.** Every node is derived from one stored row —
 * `automation_rules` for the trigger, `automation_conditions` and `automation_actions` for the
 * steps — and carries that row's id as its reference. Edits go back through the existing domain
 * commands to those rows; nothing here is persisted, so the drawing cannot disagree with what
 * `app.run_automation` executes. A later, versioned workflow engine would produce the same shape
 * from its own records and leave every renderer unchanged.
 *
 * **The shape is the rule runtime's, stated rather than implied.** One trigger; conditions that
 * must all hold (there is no `or` and no nesting); actions run in order. There is no branch and no
 * free connection, so the edges are computed, not drawn by a person, and no renderer may let
 * someone connect two nodes the runtime would not connect.
 *
 * **Layout is presentation.** Positions are computed from the order of steps and are not stored.
 */

export type WorkflowIssue = {
  severity: 'error' | 'warning';
  message: string;
  /** Absent for an issue about the whole workflow. */
  nodeId?: string;
};

export type WorkflowNode = {
  /** `trigger` for the trigger; otherwise the stored condition or action id. */
  id: string;
  role: Exclude<WorkflowNodeRole, 'logic'>;
  /** A `WORKFLOW_NODE_TYPES` entry, always an executable one. */
  type: string;
  /** The step's title, the same in every renderer and in the inspector. */
  label: string;
  /** The line under the title. Empty when the title already says it all, as for a condition. */
  summary: string;
  /** The stored row this node is drawn from. */
  record: { table: 'automation_rules' | 'automation_conditions' | 'automation_actions'; id: string };
  /** 1-based position in reading order: trigger, conditions, then actions. */
  step: number;
  /** 1-based position among nodes of the same role. */
  index: number;
  /** What a person who may manage rules can do to this node through the existing commands. */
  operations: { edit: boolean; remove: boolean };
  issues: WorkflowIssue[];
  layout: { x: number; y: number };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  /** `if` leads into the conditions, `and` joins them, `then` leads into and between actions. */
  kind: 'if' | 'and' | 'then';
};

export type WorkflowGraph = {
  id: string;
  name: string;
  enabled: boolean;
  /** Who owns it and where it is stored. Only business-owned rules are projected today. */
  source: { ownership: 'organization'; kind: 'automation_rule'; ruleId: string };
  /** The execution semantics the runtime applies, so a renderer never has to infer them. */
  semantics: {
    conditions: 'all' | 'not_applicable';
    actions: 'in_order';
    branching: false;
    triggerEditable: false;
    reorderable: false;
  };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Every issue, including those also attached to a node. */
  issues: WorkflowIssue[];
};

const ROW_GAP = 132;

export function projectRule(
  rule: AutomationRule,
  input: {
    references: WorkflowReferences;
    /** Rule-level warnings from `reviewAutomationRules`, already filtered to this rule. */
    warnings?: string[];
  },
): WorkflowGraph {
  const { references } = input;
  const counted = rule.triggerKind === 'counter_threshold';
  const nodes: WorkflowNode[] = [];
  let step = 0;
  const place = () => ({ x: 0, y: step * ROW_GAP });

  nodes.push({
    id: 'trigger',
    role: 'trigger',
    type: `trigger.${rule.triggerKind}`,
    label: nodeType(`trigger.${rule.triggerKind}`)?.label ?? 'Trigger',
    summary: describeTrigger(rule),
    record: { table: 'automation_rules', id: rule.id },
    step: ++step,
    index: 1,
    // The column grant refuses changing what a rule fires on; a different trigger is a new rule.
    operations: { edit: false, remove: false },
    issues: [],
    layout: place(),
  });

  rule.conditions.forEach((condition, position) => {
    nodes.push({
      id: condition.id,
      role: 'condition',
      type: 'condition.job_field',
      // Every condition is a job condition, so the title is what this one checks.
      label: describeCondition(condition, references),
      summary: '',
      record: { table: 'automation_conditions', id: condition.id },
      step: ++step,
      index: position + 1,
      operations: { edit: true, remove: true },
      issues: [],
      layout: place(),
    });
  });

  rule.actions.forEach((action, position) => {
    const issues: WorkflowIssue[] = [];
    const missing = (message: string) => issues.push({ severity: 'error', message, nodeId: action.id });
    if ((action.kind === 'change_status' || action.kind === 'create_work_item') &&
        !references.statuses.some((entry) => entry.id === action.statusId)) {
      missing('The stage this moves to no longer exists.');
    }
    if (action.kind === 'create_work_item' && !references.types.some((entry) => entry.id === action.typeId)) {
      missing('The kind of work this raises no longer exists.');
    }
    if (action.kind === 'notify' && !references.templates.some((entry) => entry.id === action.templateId)) {
      missing('The message this sends no longer exists.');
    }
    nodes.push({
      id: action.id,
      role: 'action',
      type: `action.${action.kind}`,
      label: ACTION_LABELS[action.kind] ?? 'Action',
      summary: describeAction(action, references),
      record: { table: 'automation_actions', id: action.id },
      step: ++step,
      index: position + 1,
      // A connected tool's settings are bound to the grant it created; it is replaced, not edited.
      operations: { edit: action.kind !== 'run_tool', remove: true },
      issues,
      layout: place(),
    });
  });

  const edges: WorkflowEdge[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    const kind: WorkflowEdge['kind'] =
      current.role === 'condition' ? (previous.role === 'condition' ? 'and' : 'if') : 'then';
    edges.push({ id: `${previous.id}->${current.id}`, source: previous.id, target: current.id, kind });
  }

  const issues: WorkflowIssue[] = nodes.flatMap((node) => node.issues);
  if (!rule.actions.length) {
    issues.push({ severity: 'warning', message: 'Does nothing until an action is added.' });
  }
  for (const message of input.warnings ?? []) issues.push({ severity: 'warning', message });

  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    source: { ownership: 'organization', kind: 'automation_rule', ruleId: rule.id },
    semantics: {
      conditions: counted ? 'not_applicable' : 'all',
      actions: 'in_order',
      branching: false,
      triggerEditable: false,
      reorderable: false,
    },
    nodes,
    edges,
    issues,
  };
}
