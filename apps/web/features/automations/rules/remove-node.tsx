'use client';
import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import {
  removeActionAction,
  removeConditionAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE } from '../shared';

export function RemoveRuleNode({
  organizationId,
  ruleId,
  nodeId,
  kind,
}: {
  organizationId: string;
  ruleId: string;
  nodeId: string;
  kind: 'action' | 'condition';
}) {
  const [state, formAction, pending] = useActionState(
    kind === 'action' ? removeActionAction : removeConditionAction,
    INITIAL_AUTOMATION_ACTION_STATE,
  );
  const formId = `remove-${kind}-${nodeId}`;
  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <input
        type="hidden"
        name={kind === 'action' ? 'actionId' : 'conditionId'}
        value={nodeId}
      />
      <ConfirmSubmit
        formId={formId}
        label={`Remove ${kind}`}
        confirmLabel={`Remove ${kind}`}
        description={`Remove this ${kind} from the current rule? Historical executions remain recorded.`}
        pending={pending}
        tone="text"
        size="small"
      />
      <ActionError state={state} />
    </form>
  );
}
