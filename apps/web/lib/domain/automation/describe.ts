import { COMPARISONS, METRICS, TRIGGER_EVENTS, type AutomationRule } from './rules';

/**
 * Minutes, in the words somebody would use.
 *
 * Stored as one number because a duration is one number; read back as hours or days because
 * "two hours" is what a business said and "120 minutes" is what the column holds.
 */
export function describeMinutes(minutes: number): string {
  if (minutes % 1440 === 0 && minutes >= 1440) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}

/**
 * A rule's trigger, as a sentence — the one place this is written, read by the Rules list and
 * the rule detail page alike (both used to carry their own copy inside `AutomationRuleCard`).
 *
 * Four kinds and four sentences, because they are genuinely different things and one phrasing
 * that covered all of them would describe none of them well. The trigger is never editable after
 * creation (the column grant refuses it), so this is read-only wherever it appears.
 */
export function describeTrigger(rule: AutomationRule): string {
  if (rule.triggerKind === 'schedule') {
    return `${describeMinutes(-(rule.triggerOffsetMinutes ?? 0))} before a job starts`;
  }

  if (rule.triggerKind === 'counter_threshold') {
    // The number and the unit are the business's own, printed as typed. A rule counting hours
    // and one counting kilometres are different rules and nothing converts between them.
    return `Every ${rule.triggerCounterStep} ${rule.triggerUnit} on a machine`;
  }

  if (rule.triggerKind === 'external_reading') {
    const metric = METRICS.find((entry) => entry.metric === rule.triggerMetric)?.label ?? rule.triggerMetric;
    const comparison =
      COMPARISONS.find((entry) => entry.comparison === rule.triggerComparison)?.label ??
      rule.triggerComparison;
    // The number and the unit are the business's own, printed as typed. Nothing converts.
    return `When ${metric} at the job ${comparison} ${rule.triggerThreshold} ${rule.triggerUnit}`;
  }

  const event = TRIGGER_EVENTS.find((entry) => entry.action === rule.triggerEventAction);
  return `When ${event?.label ?? rule.triggerEventAction}`;
}

/** What a rule's steps refer to, by id, so a step can be read back in the business's own words. */
export type WorkflowReferences = {
  /** Every stage of every kind of work, labelled "Kind — Stage". */
  statuses: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  types: { id: string; name: string }[];
  /** This business's own job fields, by key. */
  fields: { key: string; label: string }[];
};

// Plain words for the codes a rule stores; a code is never shown as stored.
const FIELD_WORD: Record<string, string> = {
  title: 'Title',
  status_id: 'Stage',
  type_id: 'Kind of work',
  customer_id: 'Customer',
  resource_id: 'Resource',
  location_id: 'Location',
  asset_id: 'Asset',
};
const OPERATOR_WORD: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  is_set: 'has been filled in',
  is_empty: 'is empty',
};
const CHANNEL_WORD: Record<string, string> = { email: 'Email', sms: 'Text message' };

export function describeCondition(
  condition: AutomationRule['conditions'][number],
  references: WorkflowReferences,
): string {
  const field =
    references.fields.find((entry) => `custom.${entry.key}` === condition.subjectField)?.label ??
    FIELD_WORD[condition.subjectField] ??
    'A field';
  // A stage or kind of work is stored by id; one that has since been deleted is named as such,
  // never printed as its id.
  const removed: Record<string, string> = { status_id: 'a removed stage', type_id: 'a removed kind of work' };
  const value =
    references.statuses.find((entry) => entry.id === condition.value)?.label ??
    references.types.find((entry) => entry.id === condition.value)?.name ??
    (condition.value && removed[condition.subjectField]) ??
    condition.value ??
    '';
  return `${field} ${OPERATOR_WORD[condition.operator] ?? 'is'} ${value}`.trim();
}

export function describeAction(
  action: AutomationRule['actions'][number],
  references: WorkflowReferences,
): string {
  if (action.kind === 'run_tool') return `${action.toolLabel ?? 'A connected tool'} · reads only`;
  if (action.kind === 'notify') {
    const template = references.templates.find((entry) => entry.id === action.templateId)?.name ?? 'Missing message';
    return `${template} · ${(action.channel && CHANNEL_WORD[action.channel]) ?? 'Message'} · the job's customer`;
  }
  if (action.kind === 'shift_schedule') {
    const minutes = action.shiftMinutes ?? 0;
    return `${describeMinutes(Math.abs(minutes))} ${minutes < 0 ? 'earlier' : 'later'}`;
  }
  const stage = references.statuses.find((entry) => entry.id === action.statusId)?.label ?? 'Missing stage';
  if (action.kind === 'create_work_item') {
    const type = references.types.find((entry) => entry.id === action.typeId)?.name ?? 'Missing kind of work';
    return `${type} · ${stage}`;
  }
  return stage;
}
