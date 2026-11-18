import { ACTION_KINDS, TRIGGER_KINDS, type ActionKind, type TriggerKind } from './rules';

/**
 * The node vocabulary a workflow is drawn from.
 *
 * **One registry, and it is a projection of the rule vocabulary rather than a second one.** Every
 * `executable` entry below names a trigger kind, a condition or an action kind that
 * `app.run_automation` already performs; the constants in `rules.ts` stay the authority and this
 * file only says how each is drawn and where it is stored. A test holds the two in step.
 *
 * **`planned` entries exist so a later engine has somewhere to land, never so a screen can offer
 * them.** An incoming webhook, an outgoing HTTP request, an AI agent step and a branch have no
 * code behind them in the rule runtime. `paletteFor` never returns one, `projectRule` never
 * produces one, and nothing persists one: a step a business could place and nothing could run is
 * exactly what the rule tables' checked vocabularies were written to prevent.
 */

export type WorkflowNodeRole = 'trigger' | 'condition' | 'action' | 'logic';

export type WorkflowNodeAvailability = 'executable' | 'planned';

/** The table that holds a step's settings. Planned steps have none yet. */
export type WorkflowNodeStorage = 'automation_rules' | 'automation_conditions' | 'automation_actions';

export type WorkflowNodeType = {
  type: string;
  role: WorkflowNodeRole;
  label: string;
  availability: WorkflowNodeAvailability;
  storage: WorkflowNodeStorage | null;
  /** For a trigger: the stored `trigger_kind`. For an action: the stored `action_kind`. */
  kind?: TriggerKind | ActionKind;
};

const TRIGGER_LABELS: Record<TriggerKind, string> = {
  event: 'Something happens',
  schedule: 'Before a job starts',
  external_reading: 'Conditions at the job',
  counter_threshold: 'Machine counter',
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  change_status: 'Change stage',
  notify: 'Notify customer',
  shift_schedule: 'Move in the diary',
  create_work_item: 'Raise a job',
  run_tool: 'Use a connected tool',
};

export const WORKFLOW_NODE_TYPES: readonly WorkflowNodeType[] = [
  ...TRIGGER_KINDS.map((entry) => ({
    type: `trigger.${entry.kind}`,
    role: 'trigger' as const,
    label: TRIGGER_LABELS[entry.kind],
    availability: 'executable' as const,
    storage: 'automation_rules' as const,
    kind: entry.kind,
  })),
  {
    type: 'condition.job_field',
    role: 'condition',
    label: 'Job condition',
    availability: 'executable',
    storage: 'automation_conditions',
  },
  ...ACTION_KINDS.map((entry) => ({
    type: `action.${entry.kind}`,
    role: 'action' as const,
    label: ACTION_LABELS[entry.kind],
    availability: 'executable' as const,
    storage: 'automation_actions' as const,
    kind: entry.kind,
  })),
  // Reserved for a later, separately approved engine. None is offered, drawn or stored today.
  { type: 'trigger.incoming_webhook', role: 'trigger', label: 'Incoming webhook', availability: 'planned', storage: null },
  { type: 'action.http_request', role: 'action', label: 'Send an HTTP request', availability: 'planned', storage: null },
  { type: 'action.ai_agent', role: 'action', label: 'Ask an AI agent', availability: 'planned', storage: null },
  { type: 'logic.branch', role: 'logic', label: 'Branch', availability: 'planned', storage: null },
];

export function nodeType(type: string): WorkflowNodeType | undefined {
  return WORKFLOW_NODE_TYPES.find((entry) => entry.type === type);
}

/**
 * The steps a person may add to a rule with this trigger, in the order they are offered.
 *
 * The same limits the domain commands enforce: a counter rule acts on a machine before there is a
 * job, so it takes no condition and only raises a job; a connected tool is offered only to someone
 * who may also grant the rule a connection.
 */
export function paletteFor(
  triggerKind: TriggerKind,
  options: { connectedTools: boolean },
): WorkflowNodeType[] {
  const counted = triggerKind === 'counter_threshold';
  return WORKFLOW_NODE_TYPES.filter((entry) => {
    if (entry.availability !== 'executable') return false;
    if (entry.role === 'condition') return !counted;
    if (entry.role !== 'action') return false;
    if (counted) return entry.kind === 'create_work_item';
    if (entry.kind === 'run_tool') return options.connectedTools;
    return true;
  });
}
