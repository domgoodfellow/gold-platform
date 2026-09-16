'use client';

import { useActionState } from 'react';
import { EmptyState, GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { CONDITION_FIELDS, OPERATORS, type AutomationRule } from '@/lib/domain/automation/rules';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { StatusChoice } from './rule-detail-types';
import { removeConditionAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';
import { AddConditionSheet } from './add-condition-sheet';

/** A stored value, rendered as whatever the business calls it — a status id reads as its label. */
function describeValue(value: string, statuses: StatusChoice[]): string {
  return statuses.find((status) => status.id === value)?.label ?? value;
}

/**
 * The IF section of a rule's detail page. Conditions can be added and removed only — the domain
 * layer has no update, so there is no Edit control here to invent one.
 */
export function ConditionList({
  organizationId,
  rule,
  statuses,
  definitions,
  mayManage,
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  definitions: FieldDefinition[];
  mayManage: boolean;
}) {
  return (
    <section>
      <GroupHeading>If</GroupHeading>

      {rule.conditions.length === 0 ? (
        <EmptyState className="mt-1">
          No conditions, so this runs every time its trigger occurs.
        </EmptyState>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {rule.conditions.map((condition) => {
            const field =
              CONDITION_FIELDS.find((entry) => entry.field === condition.subjectField)?.label ??
              definitions.find((entry) => `custom.${entry.key}` === condition.subjectField)?.label ??
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
                    ruleId={rule.id}
                    conditionId={condition.id}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {mayManage && rule.triggerKind !== 'counter_threshold' ? (
        <div className="mt-2">
          <AddConditionSheet
            organizationId={organizationId}
            rule={rule}
            statuses={statuses}
            definitions={definitions}
          />
        </div>
      ) : null}

      {/* Said rather than hidden — a counter rule runs about a machine before any job exists, so
          the domain layer refuses a condition here rather than accepting one nobody would ever
          consult. */}
      {rule.triggerKind === 'counter_threshold' ? (
        <Hint className="mt-1">
          This rule runs about a machine rather than a job, so there is nothing to compare yet.
        </Hint>
      ) : null}
    </section>
  );
}

function RemoveCondition({
  organizationId,
  ruleId,
  conditionId,
}: {
  organizationId: string;
  ruleId: string;
  conditionId: string;
}) {
  const [state, formAction, pending] = useActionState(removeConditionAction, INITIAL);
  const formId = `remove-condition-${conditionId}`;

  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={ruleId} />
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
      <ActionError state={state} />
    </form>
  );
}
