'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import {
  COMPARISONS,
  METRICS,
  TRIGGER_EVENTS,
  TRIGGER_KINDS,
  type TriggerKind,
} from '@/lib/domain/automation/rules';
import { createRuleAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * Establishes only a name and a trigger — the domain layer creates a rule with no conditions and
 * no actions, and this form asks for nothing it would throw away. Which trigger kind applies is
 * asked first, and only that kind's own fields render, so nobody submits seven boxes to answer
 * one question. On success `createRuleAction` redirects straight to the new rule's own detail
 * route rather than leaving the caller back on the list.
 */
export function NewAutomationSheet({ organizationId }: { organizationId: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TriggerKind | ''>('');
  const [state, formAction, pending] = useActionState(createRuleAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="small">
          <Plus aria-hidden className="size-4" /> New automation
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New automation</SheetTitle>
          <SheetDescription>
            Name it and say what sets it off. It starts with no conditions and nothing to do —
            add those from the rule&rsquo;s own page once it exists.
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="organizationId" value={organizationId} />

          <TextInput
            name="name"
            type="text"
            required
            maxLength={120}
            aria-label="What this rule is for"
            placeholder="What this rule is for"
          />

          <SelectInput
            name="triggerKind"
            aria-label="What sets it off"
            value={kind}
            onChange={(event) => setKind(event.target.value as TriggerKind)}
          >
            <option value="" disabled>
              What sets it off
            </option>
            {TRIGGER_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          {kind === 'event' ? (
            <SelectInput name="triggerEventAction" aria-label="Which moment">
              {TRIGGER_EVENTS.map((entry) => (
                <option key={entry.action} value={entry.action}>
                  {entry.label}
                </option>
              ))}
            </SelectInput>
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
              <SelectInput name="triggerMetric" aria-label="What is measured">
                {METRICS.map((entry) => (
                  <option key={entry.metric} value={entry.metric}>
                    {entry.label}
                  </option>
                ))}
              </SelectInput>
              <SelectInput name="triggerComparison" aria-label="Which way">
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

          {kind === '' ? <Hint>Choose what sets it off to see the rest of the form.</Hint> : null}

          <Button type="submit" disabled={pending || kind === ''} className="w-fit">
            {pending ? 'Adding…' : 'Add rule'}
          </Button>
          <ActionError state={state} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
