'use client';

import { DividedList, EmptyState, GroupHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { FormError } from '@/components/controls/form';
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
  TRIGGER_KINDS,
  type AutomationRule,
  type AutomationRun,
} from '@/lib/domain/automation/rules';
import {
  CHANNELS,
  PLACEHOLDERS,
  type MessageDelivery,
  type MessageTemplate,
} from '@/lib/domain/automation/templates';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  addActionAction,
  addConditionAction,
  createRuleAction,
  createTemplateAction,
  deleteRuleAction,
  deleteTemplateAction,
  updateTemplateAction,
  removeActionAction,
  removeConditionAction,
  renameRuleAction,
  setRuleEnabledAction,
  type AutomationActionState,
} from '@/app/organizations/[organizationId]/automations/actions';

const INITIAL: AutomationActionState = { error: null };

/** A status this business has, named by its kind of work so two "Booked" are told apart. */
export type StatusChoice = { id: string; label: string };

function Error({ state }: { state: AutomationActionState }) {
  return <FormError className="mt-1">{state.error}</FormError>;
}

/**
 * The whole grammar, on one card, read as a sentence.
 *
 * **When … if … then**, in that order, because that is the order somebody describes a rule out
 * loud. The alternative — three tabs, or a wizard — hides two thirds of a rule from the person
 * checking whether it says what they meant.
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

      {/* **Above the rule rather than beside it**, because these are reasons it will not do
          what somebody meant — and a warning under three sections of detail is a warning nobody
          reads. Never a refusal: a rule that looks wrong now may be right about statuses this
          business is halfway through setting up. */}
      {warnings.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-l-2 border-amber-500 pl-3">
          {warnings.map((warning) => (
            <li key={warning} className="text-sm opacity-80">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

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
 * Minutes, in the words somebody would use.
 *
 * Stored as one number because a duration is one number; read back as hours or days because
 * "two hours" is what a business said and "120 minutes" is what the column holds.
 */
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
      <Error state={state} />
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
      <Error state={state} />
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
      <Error state={state} />
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
      <Error state={state} />
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
      <Error state={state} />
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

      <Error state={state} />
    </form>
  );
}

/**
 * What this business says, and what it has said.
 *
 * **Every word here belongs to the business.** The placeholders are the platform's whole
 * contribution — five names for things it already has — and an unknown one is left exactly as
 * typed rather than blanked, because deleting somebody's sentence is worse than leaving a word
 * they will recognise as their own mistake.
 */
export function MessageTemplateSection({
  organizationId,
  templates,
  deliveries,
  mayManage,
  role,
}: {
  organizationId: string;
  templates: MessageTemplate[];
  deliveries: MessageDelivery[];
  mayManage: boolean;
  role: string;
}) {
  return (
    <Section id="messages" className="mt-10 scroll-mt-6">
      <SectionHeading>What this business says</SectionHeading>
      <Hint className="mt-1 max-w-2xl">
        Every word a customer reads is written here. The platform adds nothing — no greeting, no
        signature, no footer — and puts values where you write{' '}
        {PLACEHOLDERS.map((entry) => entry.token).join(', ')}. A message already sent keeps the
        words it was sent with, so editing one of these changes only what happens next.
      </Hint>
      <Hint className="mt-1 max-w-2xl">
        {/* Whether this installation can actually send on a channel is a fact about the sending
            service rather than about this business, and this screen cannot see it. Rather than
            imply everything works, it says where the answer appears: on the message itself, the
            first time one is attempted. */}
        Whether messages can be sent at all depends on what this installation is connected to.
        Each one below says what happened to it, including when there was nothing to send it
        with.
      </Hint>

      {templates.length === 0 ? (
        <EmptyState className="mt-3">Nothing written yet.</EmptyState>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {templates.map((template) =>
            mayManage ? (
              <EditTemplateForm
                key={template.id}
                organizationId={organizationId}
                template={template}
              />
            ) : (
              <article key={template.id} className="text-sm">
                <p className="font-medium">{template.name}</p>
                {template.subject ? <Hint>{template.subject}</Hint> : null}
                <Hint className="whitespace-pre-wrap">{template.body}</Hint>
              </article>
            ),
          )}
        </div>
      )}

      {mayManage ? (
        <NewTemplateForm organizationId={organizationId} />
      ) : (
        <Hint className="mt-3">
          Your role, {role}, cannot change what this business says.
        </Hint>
      )}

      {deliveries.length > 0 ? (
        <div className="mt-6">
          <GroupHeading>Sent</GroupHeading>
          <DividedList className="mt-1 text-sm">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="text-subtle">
                  {new Date(delivery.queuedAt).toLocaleString('en-GB')}
                </span>
                <span>{delivery.recipient}</span>
                <span className="text-muted">{delivery.ruleName}</span>
                {delivery.state === 'failed' ? (
                  <span className="text-danger">
                    failed — {delivery.detail}
                  </span>
                ) : (
                  <span className="text-subtle">{delivery.state}</span>
                )}
              </li>
            ))}
          </DividedList>
        </div>
      ) : null}
    </Section>
  );
}

function TemplateFields({ template }: { template?: MessageTemplate }) {
  return (
    <>
      <TextInput
        name="name"
        type="text"
        required
        maxLength={120}
        defaultValue={template?.name}
        aria-label="What this message is for"
        placeholder="What this message is for"
        size="small"
      />
      <TextInput
        name="subject"
        type="text"
        maxLength={300}
        defaultValue={template?.subject}
        aria-label="Subject line"
        placeholder="Subject line, for email"
        size="small"
      />
      <TextArea
        name="body"
        required
        maxLength={4000}
        rows={4}
        defaultValue={template?.body}
        aria-label="What it says"
        placeholder="What it says"
        size="small"
        className="w-full"
      />
    </>
  );
}

function NewTemplateForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createTemplateAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex max-w-2xl flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <GroupHeading>New message</GroupHeading>
      <TemplateFields />
      <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
        {pending ? 'Adding…' : 'Add message'}
      </Button>
      <Error state={state} />
    </form>
  );
}

function EditTemplateForm({
  organizationId,
  template,
}: {
  organizationId: string;
  template: MessageTemplate;
}) {
  const [state, formAction, pending] = useActionState(updateTemplateAction, INITIAL);
  const [removeState, removeAction, removing] = useActionState(deleteTemplateAction, INITIAL);

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateId" value={template.id} />
        <TemplateFields template={template} />
        <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
          {pending ? '…' : 'Save'}
        </Button>
        <Error state={state} />
      </form>

      <form id={`delete-template-${template.id}`} action={removeAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateId" value={template.id} />
        <ConfirmSubmit
          formId={`delete-template-${template.id}`}
          label="remove"
          confirmLabel="Remove message"
          description={`Remove "${template.name}"? Any rule using it loses its action.`}
          tone="text"
          size="tiny"
          pending={removing}
        />
        <Error state={removeState} />
      </form>
    </div>
  );
}

export function CreateAutomationRuleForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New rule</SectionHeading>

      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={120}
          aria-label="What this rule is for"
          placeholder="What this rule is for"
          size="small"
          className="flex-1"
        />

        {/* All three controls, submitted together and sorted out by the domain layer, which is
            where the rule that each kind carries only what it needs already lives. */}
        <SelectInput name="triggerKind" aria-label="What sets it off" size="small">
          {TRIGGER_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.label}
            </option>
          ))}
        </SelectInput>

        <SelectInput name="triggerEventAction" aria-label="Which moment" size="small">
          {TRIGGER_EVENTS.map((entry) => (
            <option key={entry.action} value={entry.action}>
              {entry.label}
            </option>
          ))}
        </SelectInput>

        <TextInput
          name="triggerMinutesBefore"
          type="number"
          min={0}
          max={20160}
          step={1}
          defaultValue={120}
          aria-label="Minutes before the job starts"
          size="small"
          className="w-32"
        />

        <SelectInput name="triggerMetric" aria-label="What is measured" size="small">
          {METRICS.map((entry) => (
            <option key={entry.metric} value={entry.metric}>
              {entry.label}
            </option>
          ))}
        </SelectInput>

        <SelectInput name="triggerComparison" aria-label="Which way" size="small">
          {COMPARISONS.map((entry) => (
            <option key={entry.comparison} value={entry.comparison}>
              {entry.label}
            </option>
          ))}
        </SelectInput>

        <TextInput
          name="triggerThreshold"
          type="number"
          step="any"
          defaultValue={0}
          aria-label="The line"
          size="small"
          className="w-24"
        />

        {/* Typed, never offered from a list, and never converted. A threshold in the wrong unit
            is a rule about something else, and the comparison in the database refuses to make
            it rather than quietly meeting it halfway. */}
        <TextInput
          name="triggerUnit"
          type="text"
          maxLength={16}
          placeholder="unit"
          aria-label="Unit"
          size="small"
          className="w-24"
        />

        <TextInput
          name="triggerCounterStep"
          type="number"
          step="any"
          min={0}
          placeholder="every"
          aria-label="Counter interval"
          size="small"
          className="w-24"
        />

        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Adding…' : 'Add rule'}
        </Button>
      </div>

      <Hint>
        Each kind uses only the boxes that belong to it: minutes before the job for a timed
        rule, and what is measured, which way, where the line is and in what unit for a
        conditions rule, and an interval for one that watches a counter on a machine. The unit
        is yours and is shared by the last two — nothing converts between units, so a threshold
        in one and a reading in another never meet. A rule starts with no conditions and nothing to
        do, which means it runs and changes nothing.
      </Hint>

      <Error state={state} />
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
      <Error state={state} />
    </form>
  );
}
