'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { SelectableCard } from '@/components/controls/selectable-card';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { cx } from '@/components/class-names';
import { Card } from '@/components/surfaces/card';
import { createRuleAction } from '@/app/organizations/[organizationId]/automations/actions';
import { describeTrigger } from '@/lib/domain/automation/describe';
import { COMPARISONS, METRICS, TRIGGER_EVENTS, TRIGGER_KINDS, type TriggerKind } from '@/lib/domain/automation/rules';
import { projectRule } from '@/lib/domain/automation/workflow-graph';
import { nodeType } from '@/lib/domain/automation/workflow-nodes';
import { INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';
import { automationPaths } from '../paths';
import { WorkflowList } from '../workbench/workflow-list';
import { TRIGGER_NOTES } from '../workbench/trigger-notes';
import { useDesktop } from '../workbench/use-desktop';
import {
  BEFORE_UNITS,
  EMPTY_DRAFT,
  draftFormData,
  draftRule,
  nameErrors,
  triggerErrors,
  type BeforeUnit,
  type DraftErrors,
  type DraftField,
  type WorkflowDraft,
} from './workflow-draft';

/** On a phone the page is three steps; on a wide screen every step is in view at once. */
const STEPS = ['trigger', 'details', 'name'] as const;
type Step = (typeof STEPS)[number];

/** What each trigger is, in the words that tell them apart. None is a general repeating schedule. */
const KIND_CHOICES: Record<TriggerKind, string> = {
  event: 'A job is created, booked, moved or edited',
  schedule: 'A set time before each scheduled job',
  external_reading: 'Weather at the job crosses a line',
  counter_threshold: 'Every so many hours or miles on a machine',
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const triggerLabel = (kind: TriggerKind) => nodeType(`trigger.${kind}`)?.label ?? sentence(kind);
const fieldId = (field: DraftField) => `new-workflow-${field}`;
const NO_REFERENCES = { statuses: [], templates: [], types: [], fields: [] };

/**
 * Creating a workflow, on its own page, in the workbench's own layout: the trigger choices where the
 * workbench lists steps to add, the workflow's structure where its canvas goes, and the chosen
 * trigger's settings where its inspector sits. The structure is drawn by the same projection and
 * step list as a saved workflow, so what is previewed is what gets created.
 *
 * Nothing is stored until Create: choosing or switching a trigger only changes this page's draft.
 * Create sends the name and the chosen trigger to `createRuleAction`, which checks them again,
 * creates the rule switched off and opens it in the workbench to add conditions and actions.
 */
export function NewWorkflow({ organizationId }: { organizationId: string }) {
  const paths = automationPaths(organizationId);
  const desktop = useDesktop();
  const params = useSearchParams();
  const [draft, setDraft] = useState<WorkflowDraft>(EMPTY_DRAFT);
  // Errors appear for a part of the form only once someone has tried to move past it.
  const [checked, setChecked] = useState({ kind: false, details: false, name: false });
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL);
  const [, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<Record<Step, HTMLElement | null>>({ trigger: null, details: null, name: null });
  const movedStep = useRef(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT), [draft]);
  // Leaving with a changed draft asks first; a submission in flight is about to leave on purpose.
  useUnsavedChanges(dirty && !pending);

  // The phone's step is in the address, so Back and Forward move between steps. A step that needs
  // a trigger cannot be opened without one (a reload starts the draft again).
  const requested = params.get('step');
  const step: Step = STEPS.includes(requested as Step) && (requested === 'trigger' || draft.kind) ? (requested as Step) : 'trigger';

  const goTo = (next: Step) => {
    movedStep.current = true;
    const url = new URL(window.location.href);
    if (next === 'trigger') url.searchParams.delete('step');
    else url.searchParams.set('step', next);
    window.history.pushState(null, '', url);
  };

  useEffect(() => {
    if (!movedStep.current) return;
    movedStep.current = false;
    const target = step === 'name' ? document.getElementById(fieldId('name')) : stepHeading.current[step];
    target?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    if (state.error && !pending) errorRef.current?.focus();
  }, [state, pending]);

  const trigger = triggerErrors(draft);
  const errors: DraftErrors = {
    ...(checked.kind && trigger.kind ? { kind: trigger.kind } : {}),
    ...(checked.details && !trigger.kind ? trigger : {}),
    ...(checked.name ? nameErrors(draft) : {}),
  };
  const set = <K extends keyof WorkflowDraft>(field: K, value: WorkflowDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const focusFirst = (found: DraftErrors) => {
    const first = Object.keys(found)[0] as DraftField | undefined;
    if (!first) return;
    window.setTimeout(() => {
      const element =
        first === 'kind'
          ? document.querySelector<HTMLElement>('#new-workflow-kind button')
          : document.getElementById(fieldId(first));
      element?.focus();
    }, 0);
  };

  const next = () => {
    if (step === 'trigger') {
      setChecked((current) => ({ ...current, kind: true }));
      if (draft.kind) goTo('details');
      else focusFirst(trigger);
      return;
    }
    setChecked((current) => ({ ...current, details: true }));
    if (Object.keys(trigger).length) focusFirst(trigger);
    else goTo('name');
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setChecked({ kind: true, details: true, name: true });
    if (Object.keys(trigger).length) {
      if (!desktop) goTo(trigger.kind ? 'trigger' : 'details');
      focusFirst(trigger);
      return;
    }
    const naming = nameErrors(draft);
    if (Object.keys(naming).length) {
      focusFirst(naming);
      return;
    }
    startTransition(() => formAction(draftFormData(organizationId, draft)));
  };

  const graph = useMemo(() => {
    if (!draft.kind) return null;
    const rule = draftRule({ ...draft, kind: draft.kind });
    const projected = projectRule(rule, { references: NO_REFERENCES });
    const complete = Object.keys(triggerErrors(draft)).length === 0;
    // An unfinished trigger has no sentence yet; its title still says which trigger it is.
    return {
      ...projected,
      nodes: projected.nodes.map((node) => (node.role === 'trigger' ? { ...node, summary: complete ? describeTrigger(rule) : '' } : node)),
    };
  }, [draft]);

  const onStep = (target: Step) => (step === target ? 'flex' : 'hidden lg:flex');
  const position = STEPS.indexOf(step) + 1;

  return (
    <form noValidate onSubmit={submit} aria-label="New workflow" className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0 p-0">
        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
          <fieldset id="new-workflow-kind" className={cx(onStep('trigger'), 'min-w-0 flex-col gap-2 p-4 lg:border-r lg:border-border lg:p-3')}>
            <legend className="contents">
              <h2
                ref={(element) => {
                  stepHeading.current.trigger = element;
                }}
                tabIndex={-1}
                className="mb-1 text-sm font-semibold outline-none"
              >
                What sets it off
              </h2>
            </legend>
            {TRIGGER_KINDS.map(({ kind }) => (
              <SelectableCard
                key={kind}
                selected={draft.kind === kind}
                onClick={() => {
                  // A different trigger starts with its own settings unchecked: its empty fields are
                  // not errors until someone tries to move on with them.
                  if (draft.kind !== kind) setChecked((current) => ({ ...current, details: false }));
                  set('kind', kind);
                }}
                aria-describedby={errors.kind ? 'new-workflow-kind-error' : undefined}
                className="min-h-0 gap-0.5 p-3"
              >
                <span className="text-sm font-medium">{triggerLabel(kind)}</span>
                <span className="text-xs font-normal text-subtle">{KIND_CHOICES[kind]}</span>
              </SelectableCard>
            ))}
            <ErrorText id="new-workflow-kind-error">{errors.kind}</ErrorText>
          </fieldset>

          <section aria-label="Workflow structure" className={cx(onStep('name'), 'min-w-0 flex-col bg-secondary p-4 sm:p-6')}>
            <div className="mx-auto w-full max-w-xl">
              {graph ? (
                <WorkflowList
                  graph={graph}
                  selectedId="trigger"
                  onSelect={() => (desktop ? stepHeading.current.details?.focus() : goTo('details'))}
                />
              ) : (
                <p className="text-sm text-subtle">Choose what sets it off.</p>
              )}
            </div>
          </section>

          <div className="flex min-w-0 flex-col lg:border-l lg:border-border">
            <section aria-labelledby="new-workflow-details" className={cx(draft.kind ? onStep('details') : 'hidden', 'min-w-0 flex-col gap-4 p-4 lg:border-b lg:border-border')}>
              <h2
                id="new-workflow-details"
                ref={(element) => {
                  stepHeading.current.details = element;
                }}
                tabIndex={-1}
                className="text-sm font-semibold outline-none"
              >
                {draft.kind ? triggerLabel(draft.kind) : 'Trigger'}
              </h2>
              {draft.kind ? <TriggerDetails draft={draft} errors={errors} set={set} /> : null}
              {draft.kind && TRIGGER_NOTES[draft.kind] ? <Hint>{TRIGGER_NOTES[draft.kind]}</Hint> : null}
            </section>

            <section aria-label="Name and create" className={cx(onStep('name'), 'min-w-0 flex-col gap-4 p-4')}>
              <FormField id={fieldId('name')} label="Name" error={errors.name}>
                {(field) => (
                  <TextInput
                    {...field}
                    name="name"
                    autoComplete="off"
                    maxLength={120}
                    value={draft.name}
                    onChange={(event) => set('name', event.target.value)}
                  />
                )}
              </FormField>
              <div ref={errorRef} tabIndex={-1} className="outline-none">
                <FormError>{state.error}</FormError>
              </div>
              <div className="flex flex-col gap-2">
                <FormActions>
                  <Button type="submit" loading={pending} disabled={pending}>
                    {pending ? 'Creating…' : 'Create workflow'}
                  </Button>
                  <ButtonLink href={paths.workflows}>Cancel</ButtonLink>
                </FormActions>
                <Hint>It starts switched off.</Hint>
              </div>
            </section>
          </div>
        </div>
      </Card>

      {/* A phone moves through the steps; a wide screen already shows them all. */}
      <nav aria-label="Steps" className="flex items-center justify-between gap-3 lg:hidden">
        {step === 'trigger' ? (
          <ButtonLink href={paths.workflows}>Cancel</ButtonLink>
        ) : (
          <Button type="button" tone="secondary" onClick={() => window.history.back()}>
            <ArrowLeft aria-hidden className="size-4" /> Back
          </Button>
        )}
        <span className="text-sm text-subtle">
          {position} of {STEPS.length}
        </span>
        {step === 'name' ? (
          <span aria-hidden className="w-16" />
        ) : (
          <Button type="button" onClick={next}>
            Next <ArrowRight aria-hidden className="size-4" />
          </Button>
        )}
      </nav>
    </form>
  );
}

/** Only the chosen trigger's own settings, each with a visible label. */
function TriggerDetails({
  draft,
  errors,
  set,
}: {
  draft: WorkflowDraft;
  errors: DraftErrors;
  set: <K extends keyof WorkflowDraft>(field: K, value: WorkflowDraft[K]) => void;
}) {
  if (draft.kind === 'event') {
    return (
      <FormField id={fieldId('event')} label="Which moment" error={errors.event}>
        {(field) => (
          <SelectField
            {...field}
            value={draft.event}
            onValueChange={(value) => set('event', value)}
            placeholder="Choose a moment"
            options={TRIGGER_EVENTS.map((entry) => ({ value: entry.action, label: sentence(entry.label) }))}
          />
        )}
      </FormField>
    );
  }

  if (draft.kind === 'schedule') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
          <FormField id={fieldId('beforeAmount')} label="How long before" error={errors.beforeAmount}>
            {(field) => (
              <TextInput
                {...field}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.beforeAmount}
                onChange={(event) => set('beforeAmount', event.target.value)}
              />
            )}
          </FormField>
          <FormField id="new-workflow-beforeUnit" label="Unit">
            {(field) => (
              <SelectField
                {...field}
                value={draft.beforeUnit}
                onValueChange={(value) => set('beforeUnit', value as BeforeUnit)}
                options={BEFORE_UNITS.map((entry) => ({ value: entry.unit, label: entry.label }))}
              />
            )}
          </FormField>
      </div>
    );
  }

  if (draft.kind === 'external_reading') {
    return (
      <div className="flex flex-col gap-4">
        <FormField id={fieldId('metric')} label="What is measured" error={errors.metric}>
          {(field) => (
            <SelectField
              {...field}
              value={draft.metric}
              onValueChange={(value) => set('metric', value)}
              placeholder="Choose a measurement"
              options={METRICS.map((entry) => ({ value: entry.metric, label: sentence(entry.label) }))}
            />
          )}
        </FormField>
        <FormField id={fieldId('comparison')} label="Which way" error={errors.comparison}>
          {(field) => (
            <SelectField
              {...field}
              value={draft.comparison}
              onValueChange={(value) => set('comparison', value)}
              placeholder="Choose which way"
              options={COMPARISONS.map((entry) => ({ value: entry.comparison, label: sentence(entry.label) }))}
            />
          )}
        </FormField>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
          <FormField id={fieldId('threshold')} label="Threshold" error={errors.threshold}>
            {(field) => (
              <TextInput
                {...field}
                type="number"
                inputMode="decimal"
                step="any"
                value={draft.threshold}
                onChange={(event) => set('threshold', event.target.value)}
              />
            )}
          </FormField>
          <FormField id={fieldId('readingUnit')} label="Unit" error={errors.readingUnit}>
            {(field) => (
              <TextInput
                {...field}
                maxLength={16}
                autoComplete="off"
                value={draft.readingUnit}
                onChange={(event) => set('readingUnit', event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
      <FormField id={fieldId('counterStep')} label="Every" error={errors.counterStep}>
        {(field) => (
          <TextInput
            {...field}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.counterStep}
            onChange={(event) => set('counterStep', event.target.value)}
          />
        )}
      </FormField>
      <FormField id={fieldId('counterUnit')} label="Unit" error={errors.counterUnit}>
        {(field) => (
          <TextInput
            {...field}
            maxLength={16}
            autoComplete="off"
            value={draft.counterUnit}
            onChange={(event) => set('counterUnit', event.target.value)}
          />
        )}
      </FormField>
    </div>
  );
}
