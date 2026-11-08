'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  CONDITION_FIELDS,
  OPERATORS,
  type AutomationRule,
} from '@/lib/domain/automation/rules';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { StatusChoice } from './rule-detail-types';
import { addConditionAction } from '@/app/organizations/[organizationId]/automations/actions';
import {
  ActionError,
  INITIAL_AUTOMATION_ACTION_STATE as INITIAL,
} from '../shared';
import { SelectField } from '@/components/controls/select-field';

/** Adding one condition — bounded enough for a PageDrawer, and the domain layer allows only add/remove. */
export function AddConditionSheet({
  organizationId,
  rule,
  statuses,
  definitions,
  types = [],
  condition,
}: {
  types?: { id: string; name: string }[];
  condition?: AutomationRule['conditions'][number];
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  definitions: FieldDefinition[];
}) {
  const [open, setOpen] = useState(false);
  const [operator, setOperator] = useState(condition?.operator ?? 'equals');
  const [field, setField] = useState(condition?.subjectField ?? 'title');
  const [state, formAction, pending] = useActionState(
    async (previous: typeof INITIAL, data: FormData) => {
      const result = await addConditionAction(previous, data);
      if (!result.error) setOpen(false);
      return result;
    },
    INITIAL,
  );

  const definition = definitions.find((d) => `custom.${d.key}` === field);
  const choices =
    field === 'type_id'
      ? types.map((t) => ({ value: t.id, label: t.name }))
      : definition?.kind === 'boolean'
        ? [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]
        : definition?.kind === 'select'
          ? definition.options.map((value) => ({ value, label: value }))
          : [];

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          <Plus aria-hidden className="size-4" />{' '}
          {condition ? 'Edit condition' : 'Add condition'}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>
            {condition ? 'Edit condition' : 'Add a condition'}
          </PageDrawerTitle>
          <PageDrawerDescription>
            Every condition on this rule has to hold for it to act — add a
            second rule if what you mean is &ldquo;or&rdquo;.
          </PageDrawerDescription>
        </PageDrawerHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />
          {condition && (
            <input type="hidden" name="conditionId" value={condition.id} />
          )}

          <SelectField name="subjectField" aria-label="Part of the job" value={field} onValueChange={(next) => setField(next)} options={[...CONDITION_FIELDS.map((entry) => ({ value: entry.field, label: entry.label })), ...definitions.map((definition) => ({ value: `custom.${definition.key}`, label: definition.label }))]} />

          <SelectField name="operator" aria-label="Comparison" value={operator} onValueChange={(next) => setOperator(next as typeof operator)} options={[...OPERATORS.map((entry) => ({ value: entry.operator, label: entry.label }))]} />

          {OPERATORS.find((o) => o.operator === operator)?.takesValue &&
            (choices.length ? (
              <SelectField name="value" aria-label="Value" defaultValue={condition?.value ?? ''} required options={[{ value: '', label: 'Choose a value' }, ...choices.map((choice) => ({ value: choice.value, label: choice.label }))]} />
            ) : field === 'status_id' ? (
              <SelectField name="value" aria-label="Value" defaultValue={condition?.value ?? ''} required options={[{ value: '', label: 'Choose a stage' }, ...statuses.map((status) => ({ value: status.id, label: status.label }))]} />
            ) : (
              <TextInput
                name="value"
                aria-label="Value"
                defaultValue={condition?.value ?? ''}
                required
                placeholder="Comparison value"
              />
            ))}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending
              ? 'Saving...'
              : condition
                ? 'Save condition'
                : 'Add condition'}
          </Button>
          <ActionError state={state} />
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
