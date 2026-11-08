'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  COMPARISONS,
  METRICS,
  TRIGGER_EVENTS,
  TRIGGER_KINDS,
  type TriggerKind,
} from '@/lib/domain/automation/rules';
import { createRuleAction } from '@/app/organizations/[organizationId]/automations/actions';
import {
  ActionError,
  INITIAL_AUTOMATION_ACTION_STATE as INITIAL,
} from '../shared';
import { SelectField } from '@/components/controls/select-field';

/**
 * Establishes only a name and a trigger — the domain layer creates a rule with no conditions and
 * no actions, and this form asks for nothing it would throw away. Which trigger kind applies is
 * asked first, and only that kind's own fields render, so nobody submits seven boxes to answer
 * one question. On success `createRuleAction` redirects straight to the new rule's own detail
 * route rather than leaving the caller back on the list.
 */
export function NewAutomationSheet({
  organizationId,
  defaultOpen = false,
}: {
  organizationId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<TriggerKind | ''>('');
  const [state, formAction, pending] = useActionState(
    createRuleAction,
    INITIAL,
  );

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New automation
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>New automation</PageDrawerTitle>
          <PageDrawerDescription>
            The new rule starts switched off.
          </PageDrawerDescription>
        </PageDrawerHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />

          <TextInput
            name="name"
            type="text"
            required
            maxLength={120}
            aria-label="What this rule is for"
            placeholder="What this rule is for"
          />

          <SelectField name="triggerKind" aria-label="What sets it off" value={kind} onValueChange={(next) => setKind(next as TriggerKind)} options={[{ value: '', label: 'What sets it off', disabled: true }, ...TRIGGER_KINDS.map((entry) => ({ value: entry.kind, label: entry.label }))]} />

          {kind === 'event' ? (
            <SelectField name="triggerEventAction" aria-label="Which moment" options={[...TRIGGER_EVENTS.map((entry) => ({ value: entry.action, label: entry.label }))]} />
          ) : null}

          {kind === 'schedule' ? (
            <TextInput
              name="triggerMinutesBefore"
              type="number"
              min={0}
              max={20160}
              step={1}
              defaultValue={120}
              aria-label="Minutes before the job starts"
            />
          ) : null}

          {kind === 'external_reading' ? (
            <>
              <SelectField name="triggerMetric" aria-label="What is measured" options={[...METRICS.map((entry) => ({ value: entry.metric, label: entry.label }))]} />
              <SelectField name="triggerComparison" aria-label="Which way" options={[...COMPARISONS.map((entry) => ({ value: entry.comparison, label: entry.label }))]} />
              <TextInput
                name="triggerThreshold"
                type="number"
                step="any"
                defaultValue={0}
                aria-label="The line"
              />
              {/* Typed, never offered from a list, and never converted. A threshold in the wrong
                  unit is a rule about something else. */}
              <TextInput
                name="triggerUnit"
                type="text"
                maxLength={16}
                placeholder="unit"
                aria-label="Unit"
              />
            </>
          ) : null}

          {kind === 'counter_threshold' ? (
            <>
              <TextInput
                name="triggerCounterStep"
                type="number"
                step="any"
                min={0}
                placeholder="every"
                aria-label="Counter interval"
              />
              <TextInput
                name="triggerUnit"
                type="text"
                maxLength={16}
                placeholder="unit"
                aria-label="Unit"
              />
            </>
          ) : null}

          {kind === '' ? (
            <Hint>Choose what sets it off to see the rest of the form.</Hint>
          ) : null}

          <Button
            type="submit"
            disabled={pending || kind === ''}
            className="w-fit"
          >
            {pending ? 'Adding…' : 'Add rule'}
          </Button>
          <ActionError state={state} />
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
