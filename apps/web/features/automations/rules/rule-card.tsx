'use client';

import { EmptyState, GroupHeading } from '@/components/containers/section';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { useActionState } from 'react';
import {
  ACTION_KINDS,
  COMPARISONS,
  CONDITION_FIELDS,
  METRICS,
  OPERATORS,
  TRIGGER_EVENTS,
  type AutomationRule,
  type AutomationRun,
} from '@/lib/domain/automation/rules';
import { CHANNELS, type MessageTemplate } from '@/lib/domain/automation/templates';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  addActionAction,
  addConditionAction,
  deleteRuleAction,
  removeActionAction,
  removeConditionAction,
  renameRuleAction,
  setRuleEnabledAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';
import { RuleWarnings } from '../review/rule-warnings';

/** A status this business has, named by its kind of work so two "Booked" are told apart. */
export type StatusChoice = { id: string; label: string };

/**
 * The whole grammar, on one card, read as a sentence.
 *
 * **When … if … then**, in that order, because that is the order somebody describes a rule out
 * loud. The alternative — three tabs, or a wizard — hides two thirds of a rule from the person
 * checking whether it says what they meant. Kept as one card rather than split by responsibility
 * the way the surrounding workspace was, because splitting a rule's own WHEN/IF/THEN across
 * files would be splitting the one thing this screen exists to keep readable as a sentence.
 */
export function AutomationRuleCard({
  organizationId,
  rule,
  statuses,
  templates,
  types,
  definitions,
  runs,
  warnings,
  mayManage,
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
  definitions: FieldDefinition[];
  runs: AutomationRun[];
  /** What cannot work about this rule. Advice, never a refusal — see `review.ts`. */
  warnings: string[];
  mayManage: boolean;
}) {
  const trigger = TRIGGER_EVENTS.find((entry) => entry.action === rule.triggerEventAction);

  return (
    <Card as="article">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          {/* The name is the heading and the input at once for somebody who can change it —
              the same shape an operating-hours row has. A read-only reader gets a heading. */}
          {mayManage ? (
            <RenameRuleForm organizationId={organizationId} rule={rule} />
          ) : (
            <h2 className="font-medium">{rule.name}</h2>
          )}
          {rule.enabled ? null : <span className="text-sm text-subtle">off</span>}
          <Hint>
            {/* The trigger is not editable and the column grant refuses it: changing what a rule
                watches for makes it a different rule while keeping the record of what the old
                one did. */}
            {describeTrigger(rule, trigger?.label)}
          </Hint>
        </div>

        {mayManage ? (
          <div className="flex shrink-0 gap-2">
            <EnableSwitch organizationId={organizationId} rule={rule} />
            <DeleteRule organizationId={organizationId} rule={rule} />
          </div>
        ) : null}
      </header>

      <RuleWarnings warnings={warnings} />

      <section className="mt-4">
        <GroupHeading>If</GroupHeading>
        {rule.conditions.length === 0 ? (
          <EmptyState className="mt-1">
            No conditions, so this runs every time.
          </EmptyState>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {rule.conditions.map((condition) => {
              const field =
                CONDITION_FIELDS.find((entry) => entry.field === condition.subjectField)?.label ??
                definitions.find((entry) => `custom.${entry.key}` === condition.subjectField)
                  ?.label ??
                condition.subjectField;
              const operator = OPERATORS.find((entry) => entry.operator === condition.operator);

              return (
                <li key={condition.id} className="flex items-center gap-2 text-sm">
                  <span>
                    {field} {operator?.label ?? condition.operator}
                    {condition.value ? ` ${describeValue(condition.value, statuses)}` : ''}
                  </span>
                  {mayManage ? (
                    <RemoveCondition
                      organizationId={organizationId}
                      conditionId={condition.id}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {mayManage && rule.triggerKind !== 'counter_threshold' ? (
          <AddCondition
            organizationId={organizationId}
            rule={rule}
            statuses={statuses}
            definitions={definitions}
          />
        ) : null}

        {/* Said rather than hidden. A rule on a counter runs about a machine before any job
            exists, so there is nothing here to compare — and the domain layer refuses to add a
            condition rather than accepting one nobody would ever consult. */}
        {rule.triggerKind === 'counter_threshold' ? (
          <Hint className="mt-1">
            This rule runs about a machine rather than a job, so there is nothing to compare yet.
          </Hint>
        ) : null}
      </section>

      <section className="mt-4">
        <GroupHeading>Then</GroupHeading>
        {rule.actions.length === 0 ? (
          <EmptyState className="mt-1">
            Nothing yet, so this rule does nothing. It is watching and will keep watching.
          </EmptyState>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {rule.actions.map((action) => (
              <li key={action.id} className="flex items-center gap-2 text-sm">
                <span>
                  {ACTION_KINDS.find((entry) => entry.kind === action.kind)?.label ?? action.kind}{' '}
                  {describeAction(action, statuses, templates)}
                </span>
                {mayManage ? (
                  <RemoveAction organizationId={organizationId} actionId={action.id} />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {mayManage ? (
          <AddAction
            organizationId={organizationId}
            rule={rule}
            statuses={statuses}
            templates={templates}
            types={types}
          />
        ) : null}
      </section>

      {runs.length > 0 ? (
        <section className="mt-4 border-t border-border pt-3">
          <GroupHeading>Recently</GroupHeading>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap gap-x-2">
                <span className="text-subtle">
                  {new Date(run.occurredAt).toLocaleString('en-GB')}
                </span>
                {run.outcome === 'failed' ? (
                  <span className="text-danger">failed — {run.detail}</span>
                ) : (
                  <span className="text-muted">ran</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

/** What one action does, in the words the business would use for it. */
function describeAction(
  action: AutomationRule['actions'][number],
  statuses: StatusChoice[],
  templates: MessageTemplate[],
): string {
  if (action.kind === 'create_work_item') {
    const status =
      statuses.find((entry) => entry.id === action.statusId)?.label ??
      'a status that is no longer here';
    return `starting at ${status}, titled with this rule's name`;
  }

  if (action.kind === 'notify') {
    const template =
      templates.find((entry) => entry.id === action.templateId)?.name ??
      'a message that is no longer here';
    const channel = CHANNELS.find((entry) => entry.channel === action.channel)?.label ?? '';
    return `${template} ${channel}`;
  }

  if (action.kind === 'shift_schedule') {
    const minutes = action.shiftMinutes ?? 0;
    return `${describeMinutes(Math.abs(minutes))} ${minutes < 0 ? 'earlier' : 'later'}`;
  }

  return (
    statuses.find((status) => status.id === action.statusId)?.label ??
    'a status that is no longer here'
  );
}

/**
 * A stored value, rendered as whatever the business calls it.
 *
 * A condition holds a status id because that is what the row holds; showing one to a person
 * would be the platform speaking in identifiers. Anything that is not a status this business has
 * is shown as typed — which is the right answer for a title or a custom field.
 */
function describeValue(value: string, statuses: StatusChoice[]): string {
  return statuses.find((status) => status.id === value)?.label ?? value;
}

/**
 * A rule's trigger, as a sentence.
 *
 * Three kinds and three sentences, because they are genuinely three different things and one
 * phrasing that covered all of them would describe none of them well.
 */
function describeTrigger(rule: AutomationRule, eventLabel?: string): string {
  if (rule.triggerKind === 'schedule') {
    return `${describeMinutes(-(rule.triggerOffsetMinutes ?? 0))} before a job starts`;
  }

  if (rule.triggerKind === 'counter_threshold') {
    // The number and the unit are the business's own, printed as typed. A rule counting hours
    // and one counting kilometres are different rules and nothing converts between them.
    return `Every ${rule.triggerCounterStep} ${rule.triggerUnit} on a machine`;
  }

  if (rule.triggerKind === 'external_reading') {
    const metric = METRICS.find((entry) => entry.metric === rule.triggerMetric)?.label ??
      rule.triggerMetric;
    const comparison =
      COMPARISONS.find((entry) => entry.comparison === rule.triggerComparison)?.label ??
      rule.triggerComparison;
    // The number and the unit are the business's own, printed as typed. Nothing converts.
    return `When ${metric} at the job ${comparison} ${rule.triggerThreshold} ${rule.triggerUnit}`;
  }

  return `When ${eventLabel ?? rule.triggerEventAction}`;
}

/**
 * Minutes, in the words somebody would use.
 *
 * Stored as one number because a duration is one number; read back as hours or days because
 * "two hours" is what a business said and "120 minutes" is what the column holds.
 */
function describeMinutes(minutes: number): string {
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

function EnableSwitch({
  organizationId,
  rule,
}: {
  organizationId: string;
  rule: AutomationRule;
}) {
  const [state, formAction, pending] = useActionState(setRuleEnabledAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="enabled" value={rule.enabled ? '0' : '1'} />
      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? '…' : rule.enabled ? 'Switch off' : 'Switch on'}
      </Button>
      <ActionError state={state} />
    </form>
  );
}

function DeleteRule({ organizationId, rule }: { organizationId: string; rule: AutomationRule }) {
  const [state, formAction, pending] = useActionState(deleteRuleAction, INITIAL);
  const formId = `delete-rule-${rule.id}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove rule"
        description={`Remove "${rule.name}"? Its conditions and actions go with it.`}
        tone="secondary"
        size="small"
        pending={pending}
      />
      <ActionError state={state} />
    </form>
  );
}

function RemoveCondition({
  organizationId,
  conditionId,
}: {
  organizationId: string;
  conditionId: string;
}) {
  const [state, formAction, pending] = useActionState(removeConditionAction, INITIAL);
  const formId = `remove-condition-${conditionId}`;

  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="conditionId" value={conditionId} />
      <ConfirmSubmit
        formId={formId}
        label="remove"
        confirmLabel="Remove condition"
        description="Remove this condition from the rule?"
        tone="text"
        size="tiny"
        pending={pending}
      />
      <ActionError state={state} />
    </form>
  );
}

function RemoveAction({
  organizationId,
  actionId,
}: {
  organizationId: string;
  actionId: string;
}) {
  const [state, formAction, pending] = useActionState(removeActionAction, INITIAL);
  const formId = `remove-action-${actionId}`;

  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="actionId" value={actionId} />
      <ConfirmSubmit
        formId={formId}
        label="remove"
        confirmLabel="Remove action"
        description="Remove this action from the rule?"
        tone="text"
        size="tiny"
        pending={pending}
      />
      <ActionError state={state} />
    </form>
  );
}

function AddCondition({
  organizationId,
  rule,
  statuses,
  definitions,
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(addConditionAction, INITIAL);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />

      <SelectInput name="subjectField" aria-label="Part of the job" size="small">
        {CONDITION_FIELDS.map((entry) => (
          <option key={entry.field} value={entry.field}>
            {entry.label}
          </option>
        ))}
        {/* This business's own fields, offered from the registry it already keeps. There is no
            second list of what a rule may look at, which is what keeps the two in step. */}
        {definitions.map((definition) => (
          <option key={definition.id} value={`custom.${definition.key}`}>
            {definition.label}
          </option>
        ))}
      </SelectInput>

      <SelectInput name="operator" aria-label="Comparison" size="small">
        {OPERATORS.map((entry) => (
          <option key={entry.operator} value={entry.operator}>
            {entry.label}
          </option>
        ))}
      </SelectInput>

      {/* One free-text box and one status picker, because a value is either an id this business
          owns or something somebody types. Leaving both is what the presence operators want. */}
      <TextInput
        name="value"
        type="text"
        aria-label="Value"
        placeholder="value"
        list={`statuses-${rule.id}`}
        size="small"
      />
      <datalist id={`statuses-${rule.id}`}>
        {statuses.map((status) => (
          <option key={status.id} value={status.id}>
            {status.label}
          </option>
        ))}
      </datalist>

      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? '…' : 'Add condition'}
      </Button>
      <ActionError state={state} />
    </form>
  );
}

function AddAction({
  organizationId,
  rule,
  statuses,
  templates,
  types,
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addActionAction, INITIAL);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />

      {/* Every field for every kind, submitted together and sorted out by the domain layer,
          which is where the rule that each kind carries only what it needs already lives. A
          control that rewrote itself as the picker changed would be more moving parts than a
          business choosing between two actions is asking for. */}
      <SelectInput name="kind" aria-label="What to do" size="small">
        {ACTION_KINDS.map((entry) => (
          <option key={entry.kind} value={entry.kind}>
            {entry.label}
          </option>
        ))}
      </SelectInput>

      <SelectInput name="statusId" aria-label="Status" size="small">
        {statuses.map((status) => (
          <option key={status.id} value={status.id}>
            {status.label}
          </option>
        ))}
      </SelectInput>

      <SelectInput name="templateId" aria-label="Message" size="small">
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </SelectInput>

      <SelectInput name="channel" aria-label="How to reach them" size="small">
        {CHANNELS.map((entry) => (
          <option key={entry.channel} value={entry.channel}>
            {entry.label}
          </option>
        ))}
      </SelectInput>

      <SelectInput name="typeId" aria-label="Kind of work" size="small">
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </SelectInput>

      {/* Signed, and negative brings a job forward. A business moving work away from bad
          weather types a positive number; one pulling it earlier types a negative one. */}
      <TextInput
        name="shiftMinutes"
        type="number"
        min={-20160}
        max={20160}
        step={1}
        defaultValue={1440}
        aria-label="Minutes to move it by"
        size="small"
        className="w-32"
      />

      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? '…' : 'Add action'}
      </Button>

      {statuses.length === 0 ? (
        <span className="text-xs text-muted">
          This business has no statuses yet, so there is nowhere for a rule to move a job.
        </span>
      ) : null}

      {templates.length === 0 ? (
        <span className="text-xs text-muted">
          No messages written yet, so there is nothing to send. Write one below.
        </span>
      ) : null}

      <ActionError state={state} />
    </form>
  );
}

/** The rule's own name, editable in place. */
function RenameRuleForm({
  organizationId,
  rule,
}: {
  organizationId: string;
  rule: AutomationRule;
}) {
  const [state, formAction, pending] = useActionState(renameRuleAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <TextInput
        name="name"
        type="text"
        required
        maxLength={120}
        defaultValue={rule.name}
        aria-label="Rule name"
        size="small"
        className="font-medium"
      />
      <Button type="submit" disabled={pending} tone="text" size="tiny">
        {pending ? '…' : 'rename'}
      </Button>
      <ActionError state={state} />
    </form>
  );
}
