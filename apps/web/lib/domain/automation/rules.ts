import { CHANNELS } from '@/lib/domain/automation/templates';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Rules a business writes, as data.
 *
 * **The vocabulary below is the platform's and the rules are the tenant's**, and the split is
 * the same one `capabilities.ts` makes: each constant here names something this code actually
 * does, so adding one means writing the code, the policy and a migration extending a checked
 * array. Everything else — what a rule is called, what it watches for, what it decides, what it
 * does — is rows a business wrote, rendered as written.
 *
 * **Nothing here evaluates a rule.** The runtime is `app.run_automation` and the trigger that
 * calls it, both in the database (D30), and that is not an implementation detail: a rule tripped
 * by a stranger's booking runs in a transaction where `app.current_tenant_ids()` is empty, and a
 * rule tripped by the scheduler runs in one with no person in it at all. This file writes the
 * rules down and reads back what they did.
 */

/**
 * What can set a rule off.
 *
 * **An event fires inside the write that caused it; a schedule fires because something asked
 * what is due.** They are genuinely different shapes and not two settings of one — the first
 * runs in a transaction a person started, the second in one nobody is in. An external reading is
 * the third and arrives with the thing that can take a reading.
 */
export const TRIGGER_KINDS = [
  { kind: 'event', label: 'when something happens' },
  { kind: 'schedule', label: 'a set time before a job starts' },
  { kind: 'external_reading', label: 'when conditions at the job cross a line' },
  { kind: 'counter_threshold', label: 'every so many hours or miles on a machine' },
] as const;

/**
 * What can be measured at a place.
 *
 * **This is the whole of weather in this codebase** (D11): a metric a provider can answer, and
 * a number a business types. There is no weather entity, no weather rule the platform knows by
 * name, and no directory named after it. The threshold and the unit belong to the business.
 */
export const METRICS = [
  { metric: 'temperature', label: 'temperature' },
  { metric: 'wind_speed', label: 'wind speed' },
  { metric: 'precipitation', label: 'rainfall' },
] as const;

export const COMPARISONS = [
  { comparison: 'above', label: 'goes above' },
  { comparison: 'below', label: 'drops below' },
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number]['kind'];

/**
 * The moments a rule can watch for.
 *
 * These are `events.action` strings, which is why they read as a record of what happened rather
 * than as commands. The list is short on purpose: every one of them is a moment a business would
 * recognise, and the ones left out — a cost recorded, a line added — are bookkeeping rather than
 * events anybody would act on.
 */
export const TRIGGER_EVENTS = [
  { action: 'work_item.created', label: 'a job is created' },
  { action: 'work_item.booked', label: 'somebody books through the public page' },
  { action: 'work_item.status_changed', label: 'a job changes status' },
  { action: 'work_item.scheduled', label: 'a job is put in the diary' },
  { action: 'work_item.unscheduled', label: 'a job is taken out of the diary' },
  { action: 'work_item.updated', label: 'a job’s details are edited' },
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]['action'];

/** The parts of a job a condition can look at, besides this tenant's own fields. */
export const CONDITION_FIELDS = [
  { field: 'title', label: 'title' },
  { field: 'status_id', label: 'status' },
  { field: 'type_id', label: 'kind of work' },
  { field: 'customer_id', label: 'customer' },
  { field: 'resource_id', label: 'resource' },
  { field: 'location_id', label: 'location' },
  { field: 'asset_id', label: 'asset' },
] as const;

export const OPERATORS = [
  { operator: 'equals', label: 'is', takesValue: true },
  { operator: 'not_equals', label: 'is not', takesValue: true },
  { operator: 'is_set', label: 'has been filled in', takesValue: false },
  { operator: 'is_empty', label: 'is empty', takesValue: false },
] as const;

export type Operator = (typeof OPERATORS)[number]['operator'];

/**
 * What a rule can do.
 *
 * Two kinds. Each arrived with the slice that can perform it, and each is a write the platform
 * already lets a person make — a status this business wired, a message this business wrote.
 */
export const ACTION_KINDS = [
  { kind: 'change_status', label: 'move it to' },
  { kind: 'notify', label: 'tell the customer' },
  // **Shifts by an amount the business typed, and never searches for a free slot.** Searching
  // is `freeWindows`, and a second one of those is exactly what I4 and I5 exist to forbid — see
  // `constraints.md` D30. What decides whether the move lands is the exclusion constraint (I6),
  // and a refusal is recorded as a failed run rather than swallowed.
  { kind: 'shift_schedule', label: 'move it in the diary by' },
  // The one action that makes work rather than changing it, and the only one a counter rule can
  // use — a counter fires before there is a job. The new job is titled with the rule's own name,
  // which is the business's sentence about why the work exists.
  { kind: 'create_work_item', label: 'raise a job' },
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number]['kind'];

export type AutomationCondition = {
  id: string;
  subjectField: string;
  operator: Operator;
  value: string | null;
};

export type AutomationAction = {
  id: string;
  kind: ActionKind;
  statusId: string | null;
  templateId: string | null;
  channel: string | null;
  shiftMinutes: number | null;
  typeId: string | null;
};

export type AutomationRule = {
  id: string;
  name: string;
  triggerKind: TriggerKind;
  triggerEventAction: string | null;
  /** Minutes from a job's scheduled start. Negative is before, which is what a reminder is. */
  triggerOffsetMinutes: number | null;
  /** What is measured, where the business drew the line, and in whose units. All four or none. */
  triggerMetric: string | null;
  triggerComparison: string | null;
  triggerThreshold: number | null;
  triggerUnit: string | null;
  /** How far a counter has to move. Shares `triggerUnit`, because it means the same thing. */
  triggerCounterStep: number | null;
  enabled: boolean;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
};

export type AutomationRun = {
  id: string;
  ruleId: string;
  /** Snapshotted when it ran, so a renamed rule leaves the record readable (I8). */
  ruleName: string;
  subjectType: string;
  subjectId: string;
  outcome: 'done' | 'failed';
  detail: string | null;
  occurredAt: string;
};

const NAME_MAX = 120;

function isTriggerEvent(value: string): value is TriggerEvent {
  return TRIGGER_EVENTS.some((entry) => entry.action === value);
}

/**
 * Every rule this business has, with what it watches for and what it does.
 *
 * Three queries rather than an embed, for the reason `listLocations` gives: the composite keys
 * that make a cross-tenant row unwritable also make every embed need a constraint hint.
 */
export async function listAutomationRules(
  db: Db,
  input: { organizationId: string },
): Promise<AutomationRule[]> {
  const { data, error } = await db
    .from('automation_rules')
    .select(
      'id, name, trigger_kind, trigger_event_action, trigger_offset_minutes, trigger_metric, trigger_comparison, trigger_threshold, trigger_unit, trigger_counter_step, enabled, created_at',
    )
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'automations.list_failed');
  }

  const rules = data ?? [];
  if (rules.length === 0) return [];

  const [conditions, actions] = await Promise.all([
    db
      .from('automation_conditions')
      .select('id, rule_id, subject_field, operator, value, position')
      .eq('organization_id', input.organizationId)
      .order('position', { ascending: true }),
    db
      .from('automation_actions')
      .select(
        'id, rule_id, action_kind, status_id, template_id, channel, shift_minutes, work_item_type_id, position',
      )
      .eq('organization_id', input.organizationId)
      .order('position', { ascending: true }),
  ]);

  if (conditions.error) {
    throw new DomainError(conditions.error.message, 'automations.conditions_failed');
  }
  if (actions.error) {
    throw new DomainError(actions.error.message, 'automations.actions_failed');
  }

  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    triggerKind: rule.trigger_kind as TriggerKind,
    triggerEventAction: rule.trigger_event_action,
    triggerOffsetMinutes: rule.trigger_offset_minutes,
    triggerMetric: rule.trigger_metric,
    triggerComparison: rule.trigger_comparison,
    triggerThreshold: rule.trigger_threshold,
    triggerUnit: rule.trigger_unit,
    triggerCounterStep: rule.trigger_counter_step,
    enabled: rule.enabled,
    conditions: (conditions.data ?? [])
      .filter((row) => row.rule_id === rule.id)
      .map((row) => ({
        id: row.id,
        subjectField: row.subject_field,
        operator: row.operator as Operator,
        value: row.value,
      })),
    actions: (actions.data ?? [])
      .filter((row) => row.rule_id === rule.id)
      .map((row) => ({
        id: row.id,
        kind: row.action_kind as ActionKind,
        statusId: row.status_id,
        templateId: row.template_id,
        channel: row.channel,
        shiftMinutes: row.shift_minutes,
        typeId: row.work_item_type_id,
      })),
    createdAt: rule.created_at,
  }));
}

/**
 * Write a rule down.
 *
 * **It is created with no conditions and no actions, and that is on purpose.** A rule that does
 * nothing yet is inert — the trigger runs it, no action performs anything, and no run is
 * recorded — so a business can name the moment it cares about before it has decided what to do
 * about it. A form that demanded all three at once would make somebody who is still thinking
 * abandon the screen.
 */
export async function createAutomationRule(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    triggerKind: string;
    /** Required when the kind is `event`. */
    triggerEventAction?: string;
    /** Required when the kind is `schedule`. Minutes before a job starts, as a positive number. */
    triggerMinutesBefore?: number;
    /** All four required when the kind is `external_reading`, and all four are the business's. */
    triggerMetric?: string;
    triggerComparison?: string;
    triggerThreshold?: number;
    triggerUnit?: string;
    /** Required when the kind is `counter_threshold`, along with the unit it counts in. */
    triggerCounterStep?: number;
  },
): Promise<string> {
  const actor = await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A rule needs a name.', 'automations.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'automations.name_too_long',
    );
  }

  if (!TRIGGER_KINDS.some((entry) => entry.kind === input.triggerKind)) {
    throw new DomainError('This platform has no such trigger.', 'automations.trigger_unknown');
  }

  const scheduled = input.triggerKind === 'schedule';
  const measured = input.triggerKind === 'external_reading';
  const counted = input.triggerKind === 'counter_threshold';

  if (
    !scheduled &&
    !measured &&
    !counted &&
    !isTriggerEvent(input.triggerEventAction ?? '')
  ) {
    throw new DomainError(
      'This platform has no such trigger.',
      'automations.trigger_unknown',
    );
  }

  if (measured) {
    if (!METRICS.some((entry) => entry.metric === input.triggerMetric)) {
      throw new DomainError(
        'This platform cannot measure that.',
        'automations.metric_unknown',
      );
    }
    if (!COMPARISONS.some((entry) => entry.comparison === input.triggerComparison)) {
      throw new DomainError(
        'This platform has no such comparison.',
        'automations.comparison_unknown',
      );
    }
    if (input.triggerThreshold === undefined || !Number.isFinite(input.triggerThreshold)) {
      throw new DomainError('A line has to be drawn somewhere.', 'automations.threshold_required');
    }
    // **The unit is required and is never assumed**, for the reason the reading table gives: a
    // rule written in one unit against a reading taken in another is a rule about something
    // else, and nothing anywhere converts between them.
    if (!input.triggerUnit || input.triggerUnit.trim().length === 0) {
      throw new DomainError(
        'A threshold needs the unit it is measured in.',
        'automations.unit_required',
      );
    }
  }

  // **Typed as "before", stored as negative**, because that is how somebody says it out loud —
  // "two hours before it starts" — and the column is signed so that "after" needs no second
  // column when something asks for it.
  if (scheduled) {
    const minutes = input.triggerMinutesBefore;
    if (minutes === undefined || !Number.isInteger(minutes) || minutes < 0 || minutes > 20160) {
      throw new DomainError(
        'A reminder runs between now and fourteen days before the job starts.',
        'automations.offset_invalid',
      );
    }
  }

  if (counted) {
    const step = input.triggerCounterStep;
    if (step === undefined || !Number.isFinite(step) || step <= 0) {
      throw new DomainError(
        'A rule on a counter needs an interval to count.',
        'automations.step_invalid',
      );
    }
    if (!input.triggerUnit || input.triggerUnit.trim().length === 0) {
      throw new DomainError(
        'An interval needs the unit the counter is read in.',
        'automations.unit_required',
      );
    }
  }

  const { data, error } = await db
    .from('automation_rules')
    .insert({
      organization_id: input.organizationId,
      name,
      trigger_kind: input.triggerKind,
      trigger_event_action:
        scheduled || measured || counted ? null : (input.triggerEventAction ?? null),
      trigger_offset_minutes: scheduled ? -(input.triggerMinutesBefore ?? 0) : null,
      trigger_metric: measured ? (input.triggerMetric ?? null) : null,
      trigger_comparison: measured ? (input.triggerComparison ?? null) : null,
      trigger_threshold: measured ? (input.triggerThreshold ?? null) : null,
      trigger_unit: measured || counted ? (input.triggerUnit ?? '').trim() : null,
      trigger_counter_step: counted ? (input.triggerCounterStep ?? null) : null,
      created_by: actor.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('This business already has a rule with that name.', 'automations.name_taken');
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot write rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.create_failed');
  }

  return data.id;
}

/**
 * Rename a rule, or switch it off.
 *
 * **Off is a column rather than a deleted row**, which is the opposite of how a module is
 * switched off and deliberately so: a rule has a history, and a business trying one out has to
 * be able to stop it without losing what it says.
 *
 * The trigger it fires on is not editable here and the column grant refuses it. Changing what a
 * rule watches for turns it into a different rule while keeping the record of what the old one
 * did — the same reasoning that refuses a field definition's kind and key.
 */
export async function updateAutomationRule(
  db: Db,
  input: { id: string; name?: string; enabled?: boolean },
): Promise<void> {
  await requireActor(db);

  const patch: { name?: string; enabled?: boolean } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new DomainError('A rule needs a name.', 'automations.name_required');
    }
    if (name.length > NAME_MAX) {
      throw new DomainError(
        `That name is longer than ${NAME_MAX} characters.`,
        'automations.name_too_long',
      );
    }
    patch.name = name;
  }

  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
  }

  if (Object.keys(patch).length === 0) return;

  const { data, error } = await db
    .from('automation_rules')
    .update(patch)
    .eq('id', input.id)
    // A refused update matches nothing and reports success — the trap `setModuleEnabled`
    // documents. Without this a role that cannot write rules is told it switched one off.
    .select('id');

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('This business already has a rule with that name.', 'automations.name_taken');
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.update_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such rule here, or your role cannot change it.',
      'automations.not_found',
    );
  }
}

/**
 * Remove a rule.
 *
 * Its conditions and actions go with it, and **its runs do not** — `automation_runs` holds no
 * key to `automation_rules`, so what a rule did survives the rule. That absence is the same one
 * `work_item_priced_lines` keeps against the price book, and for the same reason (I8).
 */
export async function deleteAutomationRule(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('automation_rules')
    .delete()
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Your role cannot remove rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.delete_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such rule here, or your role cannot remove it.',
      'automations.not_found',
    );
  }
}

/** Add a condition. Every condition on a rule must hold for it to act — there is no `or`. */
export async function addAutomationCondition(
  db: Db,
  input: {
    organizationId: string;
    ruleId: string;
    subjectField: string;
    operator: string;
    value?: string;
  },
): Promise<void> {
  const actor = await requireActor(db);

  const operator = OPERATORS.find((entry) => entry.operator === input.operator);
  if (!operator) {
    throw new DomainError('This platform has no such comparison.', 'automations.operator_unknown');
  }

  // **Refused rather than ignored**, and that is the whole reason this check exists. Every
  // condition this platform has looks at a job, and a counter rule fires about a machine before
  // any job exists — so a condition on one would be written, believed, and never consulted.
  const { data: rule } = await db
    .from('automation_rules')
    .select('trigger_kind')
    .eq('id', input.ruleId)
    .maybeSingle();

  if (rule?.trigger_kind === 'counter_threshold') {
    throw new DomainError(
      'A rule on a counter runs about a machine rather than a job, so there is nothing here to compare.',
      'automations.conditions_not_applicable',
    );
  }

  const value = operator.takesValue ? (input.value ?? '').trim() : '';
  if (operator.takesValue && value.length === 0) {
    throw new DomainError('That comparison needs something to compare with.', 'automations.value_required');
  }

  const { error } = await db.from('automation_conditions').insert({
    organization_id: input.organizationId,
    rule_id: input.ruleId,
    subject_field: input.subjectField,
    operator: operator.operator,
    value: operator.takesValue ? value : null,
    created_by: actor.id,
  });

  if (error) {
    if (error.code === '23514') {
      // The field check, which also refuses a malformed custom field key. One message, because
      // from the form's side there is one thing wrong: the part of the job it names.
      throw new DomainError(
        'That is not a part of a job this platform can compare.',
        'automations.field_unknown',
      );
    }
    if (error.code === '23503') {
      throw new DomainError('No such rule here.', 'automations.not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.condition_failed');
  }
}

export async function removeAutomationCondition(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('automation_conditions')
    .delete()
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.condition_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such condition here, or your role cannot remove it.',
      'automations.not_found',
    );
  }
}

/**
 * Add something for a rule to do.
 *
 * The status is not checked against the rule's own type here, because it cannot be: a rule
 * watches an event rather than a kind of work, so which type it will act on is not known until
 * it acts. What keeps it honest at the moment it runs is `app.check_status_transition` (I13) —
 * a rule that moves a job somewhere that job's lifecycle forbids is refused, and the refusal is
 * recorded as a failed run rather than silently doing nothing.
 */
export async function addAutomationAction(
  db: Db,
  input: {
    organizationId: string;
    ruleId: string;
    kind: string;
    statusId?: string | null;
    templateId?: string | null;
    channel?: string | null;
    /** Required for `shift_schedule`. Signed: negative brings a job forward. */
    shiftMinutes?: number | null;
    /** Required for `create_work_item`, along with the status the new job starts in. */
    typeId?: string | null;
  },
): Promise<void> {
  const actor = await requireActor(db);

  if (!ACTION_KINDS.some((entry) => entry.kind === input.kind)) {
    throw new DomainError('This platform has no such action.', 'automations.action_unknown');
  }

  if (input.kind === 'change_status' && !input.statusId) {
    throw new DomainError('Moving a job needs a status to move it to.', 'automations.status_required');
  }

  if (input.kind === 'notify' && !input.templateId) {
    throw new DomainError(
      'Telling somebody needs a message to send them.',
      'automations.template_required',
    );
  }

  if (input.kind === 'notify' && !CHANNELS.some((entry) => entry.channel === input.channel)) {
    throw new DomainError('This platform has no such way of reaching somebody.', 'automations.channel_unknown');
  }

  if (
    input.kind === 'shift_schedule' &&
    (!Number.isInteger(input.shiftMinutes) || (input.shiftMinutes ?? 0) === 0)
  ) {
    throw new DomainError(
      'Moving a job in the diary needs a number of minutes that is not zero.',
      'automations.shift_required',
    );
  }

  if (input.kind === 'create_work_item' && (!input.typeId || !input.statusId)) {
    throw new DomainError(
      'Raising a job needs a kind of work and the status it starts in.',
      'automations.new_job_incomplete',
    );
  }

  // Each kind carries exactly what it needs. The database checks the same thing
  // (`automation_actions_config_matches_kind`); this produces the sentence.
  const notify = input.kind === 'notify';
  const shift = input.kind === 'shift_schedule';
  const raise = input.kind === 'create_work_item';

  const { error } = await db.from('automation_actions').insert({
    organization_id: input.organizationId,
    rule_id: input.ruleId,
    action_kind: input.kind,
    status_id: notify || shift ? null : (input.statusId ?? null),
    template_id: notify ? input.templateId : null,
    channel: notify ? input.channel : null,
    shift_minutes: shift ? input.shiftMinutes : null,
    work_item_type_id: raise ? input.typeId : null,
    created_by: actor.id,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'No such rule here, or that status or message is not this business’s.',
        'automations.not_found',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.action_failed');
  }
}

export async function removeAutomationAction(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('automation_actions')
    .delete()
    .eq('id', input.id)
    .select('id');

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Your role cannot change rules here.', 'automations.forbidden');
    }
    throw new DomainError(error.message, 'automations.action_failed');
  }

  if ((data ?? []).length === 0) {
    throw new DomainError(
      'No such action here, or your role cannot remove it.',
      'automations.not_found',
    );
  }
}

/**
 * What the rules have actually done.
 *
 * **Read-only from every direction.** There is no insert, update or delete policy on this table
 * and no grant either — one `security definer` function writes it and nothing else can. A record
 * of what the platform did that its users could edit would be worth nothing, which is a stronger
 * version of what makes the timeline worth something.
 */
export async function listAutomationRuns(
  db: Db,
  input: { organizationId: string; ruleId?: string; failedOnly?: boolean; limit?: number },
): Promise<AutomationRun[]> {
  let query = db
    .from('automation_runs')
    .select('id, rule_id, rule_name, subject_type, subject_id, outcome, detail, occurred_at')
    .eq('organization_id', input.organizationId)
    .order('occurred_at', { ascending: false })
    .limit(input.limit ?? 50);

  if (input.ruleId) query = query.eq('rule_id', input.ruleId);
  if (input.failedOnly) query = query.eq('outcome', 'failed');

  const { data, error } = await query;

  if (error) {
    throw new DomainError(error.message, 'automations.runs_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    outcome: row.outcome as 'done' | 'failed',
    detail: row.detail,
    occurredAt: row.occurred_at,
  }));
}
