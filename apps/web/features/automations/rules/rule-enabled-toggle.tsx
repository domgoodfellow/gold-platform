'use client';

import { useActionState } from 'react';
import { Button, type ButtonSize } from '@/components/controls/button';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import { setRuleEnabledAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

/**
 * Enabled/off, direct — no confirmation, because it is reversible and the database remains the
 * guard either way. Shared between the Rules collection row and the rule detail heading, which
 * is the one state this platform lets a caller flip without opening anything.
 */
export function RuleEnabledToggle({
  organizationId,
  rule,
  size = 'small',
}: {
  organizationId: string;
  rule: AutomationRule;
  size?: ButtonSize;
}) {
  const [state, formAction, pending] = useActionState(setRuleEnabledAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="enabled" value={rule.enabled ? '0' : '1'} />
      <Button type="submit" disabled={pending} tone="secondary" size={size}>
        {pending ? '…' : rule.enabled ? 'Switch off' : 'Switch on'}
      </Button>
      <ActionError state={state} />
    </form>
  );
}
