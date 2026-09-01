'use client';

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
} from './actions';

const INITIAL: AutomationActionState = { error: null };

const INPUT = 'rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20';
const BUTTON =
  'rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20';

/** A status this business has, named by its kind of work so two "Booked" are told apart. */
export type StatusChoice = { id: string; label: string };

function Error({ state }: { state: AutomationActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
      {state.error}
    </p>
  );
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
    <article className="rounded border border-black/10 p-4 dark:border-white/15">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          {/* The name is the heading and the input at once for somebody who can change it —
              the same shape an operating-hours row has. A read-only reader gets a heading. */}
          {mayManage ? (
            <RenameRuleForm organizationId={organizationId} rule={rule} />
          ) : (
            <h2 className="font-medium">{rule.name}</h2>
          )}
          {rule.enabled ? null : <span className="text-sm opacity-60">off</span>}
          <p className="text-sm opacity-70">
            {/* The trigger is not editable and the column grant refuses it: changing what a rule
                watches for makes it a different rule while keeping the record of what the old
                one did. */}
            {describeTrigger(rule, trigger?.label)}
          </p>
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
        <h3 className="text-xs uppercase tracking-wide opacity-60">If</h3>
        {rule.conditions.length === 0 ? (
          <p className="mt-1 text-sm opacity-70">
            No conditions, so this runs every time.
          </p>
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
          <p className="mt-1 text-sm opacity-70">
            This rule runs about a machine rather than a job, so there is nothing to compare yet.
          </p>
        ) : null}
      </section>

      <section className="mt-4">
        <h3 className="text-xs uppercase tracking-wide opacity-60">Then</h3>
        {rule.actions.length === 0 ? (
          <p className="mt-1 text-sm opacity-70">
            Nothing yet, so this rule does nothing. It is watching and will keep watching.
          </p>
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
        <section className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
          <h3 className="text-xs uppercase tracking-wide opacity-60">Recently</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap gap-x-2">
                <span className="opacity-60">
                  {new Date(run.occurredAt).toLocaleString('en-GB')}
                </span>
                {run.outcome === 'failed' ? (
                  <span className="text-red-600 dark:text-red-400">failed — {run.detail}</span>
                ) : (
                  <span className="opacity-70">ran</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
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
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? '…' : rule.enabled ? 'Switch off' : 'Switch on'}
      </button>
      <Error state={state} />
    </form>
  );
}

function DeleteRule({ organizationId, rule }: { organizationId: string; rule: AutomationRule }) {
  const [state, formAction, pending] = useActionState(deleteRuleAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? '…' : 'Remove'}
      </button>
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

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="conditionId" value={conditionId} />
      <button type="submit" disabled={pending} className="text-xs underline opacity-60">
        remove
      </button>
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

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="actionId" value={actionId} />
      <button type="submit" disabled={pending} className="text-xs underline opacity-60">
        remove
      </button>
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

      <select name="subjectField" aria-label="Part of the job" className={INPUT}>
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
      </select>

      <select name="operator" aria-label="Comparison" className={INPUT}>
        {OPERATORS.map((entry) => (
          <option key={entry.operator} value={entry.operator}>
            {entry.label}
          </option>
        ))}
      </select>

      {/* One free-text box and one status picker, because a value is either an id this business
          owns or something somebody types. Leaving both is what the presence operators want. */}
      <input
        name="value"
        type="text"
        aria-label="Value"
        placeholder="value"
        list={`statuses-${rule.id}`}
        className={INPUT}
      />
      <datalist id={`statuses-${rule.id}`}>
        {statuses.map((status) => (
          <option key={status.id} value={status.id}>
            {status.label}
          </option>
        ))}
      </datalist>

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? '…' : 'Add condition'}
      </button>
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
      <select name="kind" aria-label="What to do" className={INPUT}>
        {ACTION_KINDS.map((entry) => (
          <option key={entry.kind} value={entry.kind}>
            {entry.label}
          </option>
        ))}
      </select>

      <select name="statusId" aria-label="Status" className={INPUT}>
        {statuses.map((status) => (
          <option key={status.id} value={status.id}>
            {status.label}
          </option>
        ))}
      </select>

      <select name="templateId" aria-label="Message" className={INPUT}>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>

      <select name="channel" aria-label="How to reach them" className={INPUT}>
        {CHANNELS.map((entry) => (
          <option key={entry.channel} value={entry.channel}>
            {entry.label}
          </option>
        ))}
      </select>

      <select name="typeId" aria-label="Kind of work" className={INPUT}>
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>

      {/* Signed, and negative brings a job forward. A business moving work away from bad
          weather types a positive number; one pulling it earlier types a negative one. */}
      <input
        name="shiftMinutes"
        type="number"
        min={-20160}
        max={20160}
        step={1}
        defaultValue={1440}
        aria-label="Minutes to move it by"
        className={`${INPUT} w-32`}
      />

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? '…' : 'Add action'}
      </button>

      {statuses.length === 0 ? (
        <span className="text-xs opacity-70">
          This business has no statuses yet, so there is nowhere for a rule to move a job.
        </span>
      ) : null}

      {templates.length === 0 ? (
        <span className="text-xs opacity-70">
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
    <section
      id="messages"
      className="mt-10 scroll-mt-6 border-t border-black/10 pt-6 dark:border-white/15"
    >
      <h2 className="text-sm font-medium">What this business says</h2>
      <p className="mt-1 max-w-2xl text-sm opacity-70">
        Every word a customer reads is written here. The platform adds nothing — no greeting, no
        signature, no footer — and puts values where you write{' '}
        {PLACEHOLDERS.map((entry) => entry.token).join(', ')}. A message already sent keeps the
        words it was sent with, so editing one of these changes only what happens next.
      </p>
      <p className="mt-1 max-w-2xl text-sm opacity-70">
        {/* Whether this installation can actually send on a channel is a fact about the sending
            service rather than about this business, and this screen cannot see it. Rather than
            imply everything works, it says where the answer appears: on the message itself, the
            first time one is attempted. */}
        Whether messages can be sent at all depends on what this installation is connected to.
        Each one below says what happened to it, including when there was nothing to send it
        with.
      </p>

      {templates.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing written yet.</p>
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
                {template.subject ? <p className="opacity-70">{template.subject}</p> : null}
                <p className="whitespace-pre-wrap opacity-70">{template.body}</p>
              </article>
            ),
          )}
        </div>
      )}

      {mayManage ? (
        <NewTemplateForm organizationId={organizationId} />
      ) : (
        <p className="mt-3 text-sm opacity-70">
          Your role, {role}, cannot change what this business says.
        </p>
      )}

      {deliveries.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wide opacity-60">Sent</h3>
          <ul className="mt-1 divide-y divide-black/10 text-sm dark:divide-white/15">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="opacity-60">
                  {new Date(delivery.queuedAt).toLocaleString('en-GB')}
                </span>
                <span>{delivery.recipient}</span>
                <span className="opacity-70">{delivery.ruleName}</span>
                {delivery.state === 'failed' ? (
                  <span className="text-red-600 dark:text-red-400">
                    failed — {delivery.detail}
                  </span>
                ) : (
                  <span className="opacity-60">{delivery.state}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function TemplateFields({ template }: { template?: MessageTemplate }) {
  return (
    <>
      <input
        name="name"
        type="text"
        required
        maxLength={120}
        defaultValue={template?.name}
        aria-label="What this message is for"
        placeholder="What this message is for"
        className={INPUT}
      />
      <input
        name="subject"
        type="text"
        maxLength={300}
        defaultValue={template?.subject}
        aria-label="Subject line"
        placeholder="Subject line, for email"
        className={INPUT}
      />
      <textarea
        name="body"
        required
        maxLength={4000}
        rows={4}
        defaultValue={template?.body}
        aria-label="What it says"
        placeholder="What it says"
        className={`${INPUT} w-full`}
      />
    </>
  );
}

function NewTemplateForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createTemplateAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex max-w-2xl flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <h3 className="text-xs uppercase tracking-wide opacity-60">New message</h3>
      <TemplateFields />
      <button type="submit" disabled={pending} className={`${BUTTON} w-fit`}>
        {pending ? 'Adding…' : 'Add message'}
      </button>
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
        <button type="submit" disabled={pending} className={`${BUTTON} w-fit`}>
          {pending ? '…' : 'Save'}
        </button>
        <Error state={state} />
      </form>

      <form action={removeAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="templateId" value={template.id} />
        <button type="submit" disabled={removing} className="text-xs underline opacity-60">
          remove
        </button>
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

      <h2 className="text-sm font-medium">New rule</h2>

      <div className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          type="text"
          required
          maxLength={120}
          aria-label="What this rule is for"
          placeholder="What this rule is for"
          className={`${INPUT} flex-1`}
        />

        {/* All three controls, submitted together and sorted out by the domain layer, which is
            where the rule that each kind carries only what it needs already lives. */}
        <select name="triggerKind" aria-label="What sets it off" className={INPUT}>
          {TRIGGER_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.label}
            </option>
          ))}
        </select>

        <select name="triggerEventAction" aria-label="Which moment" className={INPUT}>
          {TRIGGER_EVENTS.map((entry) => (
            <option key={entry.action} value={entry.action}>
              {entry.label}
            </option>
          ))}
        </select>

        <input
          name="triggerMinutesBefore"
          type="number"
          min={0}
          max={20160}
          step={1}
          defaultValue={120}
          aria-label="Minutes before the job starts"
          className={`${INPUT} w-32`}
        />

        <select name="triggerMetric" aria-label="What is measured" className={INPUT}>
          {METRICS.map((entry) => (
            <option key={entry.metric} value={entry.metric}>
              {entry.label}
            </option>
          ))}
        </select>

        <select name="triggerComparison" aria-label="Which way" className={INPUT}>
          {COMPARISONS.map((entry) => (
            <option key={entry.comparison} value={entry.comparison}>
              {entry.label}
            </option>
          ))}
        </select>

        <input
          name="triggerThreshold"
          type="number"
          step="any"
          defaultValue={0}
          aria-label="The line"
          className={`${INPUT} w-24`}
        />

        {/* Typed, never offered from a list, and never converted. A threshold in the wrong unit
            is a rule about something else, and the comparison in the database refuses to make
            it rather than quietly meeting it halfway. */}
        <input
          name="triggerUnit"
          type="text"
          maxLength={16}
          placeholder="unit"
          aria-label="Unit"
          className={`${INPUT} w-24`}
        />

        <input
          name="triggerCounterStep"
          type="number"
          step="any"
          min={0}
          placeholder="every"
          aria-label="Counter interval"
          className={`${INPUT} w-24`}
        />

        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add rule'}
        </button>
      </div>

      <p className="text-sm opacity-70">
        Each kind uses only the boxes that belong to it: minutes before the job for a timed
        rule, and what is measured, which way, where the line is and in what unit for a
        conditions rule, and an interval for one that watches a counter on a machine. The unit
        is yours and is shared by the last two — nothing converts between units, so a threshold
        in one and a reading in another never meet. A rule starts with no conditions and nothing to
        do, which means it runs and changes nothing.
      </p>

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
      <input
        name="name"
        type="text"
        required
        maxLength={120}
        defaultValue={rule.name}
        aria-label="Rule name"
        className={`${INPUT} font-medium`}
      />
      <button type="submit" disabled={pending} className="text-xs underline opacity-60">
        {pending ? '…' : 'rename'}
      </button>
      <Error state={state} />
    </form>
  );
}
