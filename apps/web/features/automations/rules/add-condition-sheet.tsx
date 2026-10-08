'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
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

        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />
          {condition && (
            <input type="hidden" name="conditionId" value={condition.id} />
          )}

          <SelectInput
            name="subjectField"
            aria-label="Part of the job"
            value={field}
            onChange={(e) => setField(e.target.value)}
          >
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

          <SelectInput
            name="operator"
            aria-label="Comparison"
            value={operator}
            onChange={(e) => setOperator(e.target.value as typeof operator)}
          >
            {OPERATORS.map((entry) => (
              <option key={entry.operator} value={entry.operator}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          {OPERATORS.find((o) => o.operator === operator)?.takesValue &&
            (choices.length ? (
              <SelectInput
                name="value"
                aria-label="Value"
                defaultValue={condition?.value ?? ''}
                required
              >
                <option value="">Choose a value</option>
                {choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </SelectInput>
            ) : field === 'status_id' ? (
              <SelectInput
                name="value"
                aria-label="Value"
                defaultValue={condition?.value ?? ''}
                required
              >
                <option value="">Choose a status</option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </SelectInput>
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
