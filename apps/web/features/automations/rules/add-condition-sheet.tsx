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
import { CONDITION_FIELDS, OPERATORS, type AutomationRule } from '@/lib/domain/automation/rules';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { StatusChoice } from './rule-detail-types';
import { addConditionAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/** Adding one condition — bounded enough for a Sheet, and the domain layer allows only add/remove. */
export function AddConditionSheet({
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
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addConditionAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          <Plus aria-hidden className="size-4" /> Add condition
        </Button>
      </SheetTrigger>
      <SheetContent side={mobile ? 'bottom' : 'right'} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add a condition</SheetTitle>
          <SheetDescription>
            Every condition on this rule has to hold for it to act — add a second rule if what you
            mean is &ldquo;or&rdquo;.
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />

          <SelectInput name="subjectField" aria-label="Part of the job">
            {CONDITION_FIELDS.map((entry) => (
              <option key={entry.field} value={entry.field}>
                {entry.label}
              </option>
            ))}
            {definitions.map((definition) => (
              <option key={definition.id} value={`custom.${definition.key}`}>
                {definition.label}
              </option>
            ))}
          </SelectInput>

          <SelectInput name="operator" aria-label="Comparison">
            {OPERATORS.map((entry) => (
              <option key={entry.operator} value={entry.operator}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          <TextInput
            name="value"
            type="text"
            aria-label="Value"
            placeholder="value"
            list={`statuses-${rule.id}`}
          />
          <datalist id={`statuses-${rule.id}`}>
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </datalist>

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Adding…' : 'Add condition'}
          </Button>
          <ActionError state={state} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
