'use client';

import { SectionHeading } from '@/components/containers/section';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import {
  COMPARISONS,
  METRICS,
  TRIGGER_EVENTS,
  TRIGGER_KINDS,
} from '@/lib/domain/automation/rules';
import { createRuleAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

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

      <ActionError state={state} />
    </form>
  );
}
