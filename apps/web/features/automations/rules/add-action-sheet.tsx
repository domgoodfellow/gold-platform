'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import { useIsMobile } from '@gold/ui/hooks/use-mobile';
import { ACTION_KINDS, type AutomationRule } from '@/lib/domain/automation/rules';
import { CHANNELS, type MessageTemplate } from '@/lib/domain/automation/templates';
import type { StatusChoice } from './rule-detail-types';
import { addActionAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * Adding one action — every field for every kind, submitted together and sorted out by the
 * domain layer, which is where the rule that each kind carries only what it needs already lives
 * (`addAutomationAction`). A control that rewrote itself as the picker changed would be more
 * moving parts than choosing between four actions is asking for.
 */
export function AddActionSheet({
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
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addActionAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          <Plus aria-hidden className="size-4" /> Add action
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add an action</SheetTitle>
          <SheetDescription>Fill in whichever fields belong to what you choose below.</SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />

          <SelectInput name="kind" aria-label="What to do">
            {ACTION_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput name="statusId" aria-label="Status">
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput name="templateId" aria-label="Message">
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </SelectInput>

          <SelectInput name="channel" aria-label="How to reach them">
            {CHANNELS.map((entry) => (
              <option key={entry.channel} value={entry.channel}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput name="typeId" aria-label="Kind of work">
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </SelectInput>

          {/* Signed, and negative brings a job forward. */}
          <TextInput
            name="shiftMinutes"
            type="number"
            min={-20160}
            max={20160}
            step={1}
            defaultValue={1440}
            aria-label="Minutes to move it by"
          />

          {statuses.length === 0 ? (
            <span className="text-xs text-muted">
              This business has no statuses yet, so there is nowhere for a rule to move a job.
            </span>
          ) : null}

          {templates.length === 0 ? (
            <span className="text-xs text-muted">No messages written yet, so there is nothing to send.</span>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Adding…' : 'Add action'}
          </Button>
          <ActionError state={state} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
