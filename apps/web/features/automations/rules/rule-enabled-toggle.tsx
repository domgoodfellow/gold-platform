'use client';

import { useActionState } from 'react';
import { Button, type ButtonSize } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import { setRuleEnabledAction } from '@/app/organizations/[organizationId]/automations/actions';
import {
  ActionError,
  INITIAL_AUTOMATION_ACTION_STATE as INITIAL,
} from '../shared';

export function RuleEnabledToggle({
  organizationId,
  rule,
  size = 'small',
}: {
  organizationId: string;
  rule: AutomationRule;
  size?: ButtonSize;
}) {
  const [state, formAction, pending] = useActionState(
    setRuleEnabledAction,
    INITIAL,
  );

  return (
    <form id={`enable-rule-${rule.id}`} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="enabled" value={rule.enabled ? '0' : '1'} />
      {rule.enabled ? (
        <Button type="submit" disabled={pending} tone="secondary" size={size}>
          {pending ? '…' : 'Disable'}
        </Button>
      ) : (
        <ConfirmSubmit
          formId={`enable-rule-${rule.id}`}
          label="Enable"
          confirmLabel="Enable automation"
          description={`${rule.actions.length ? 'Matching future triggers can change Work and queue Customer messages.' : 'This rule has no actions and will perform no business operation.'} Review diagnostics and provider prerequisites before enabling.`}
          pending={pending}
          tone="text"
          size={size}
        />
      )}
      <ActionError state={state} />
    </form>
  );
}
