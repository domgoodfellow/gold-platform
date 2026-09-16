'use client';

import { useActionState } from 'react';
import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/containers/dialog';
import type { AutomationRule } from '@/lib/domain/automation/rules';
import {
  deleteRuleAction,
  renameRuleAction,
} from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';
import { RuleEnabledToggle } from './rule-enabled-toggle';

/**
 * The rule detail page's own heading row — name, enabled state and delete, extracted from
 * `AutomationRuleCard` for the route that now owns them. Renaming stays inline (it needs no
 * Sheet); deleting is the one destructive action here and goes through the shared confirmation
 * dialog, whose copy says what actually happens: the rule and its current conditions/actions go,
 * its history does not.
 */
export function RuleHeading({
  organizationId,
  rule,
}: {
  organizationId: string;
  rule: AutomationRule;
}) {
  const [renameState, renameAction, renaming] = useActionState(renameRuleAction, INITIAL);
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteRuleAction, INITIAL);
  const deleteFormId = `delete-rule-${rule.id}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <form action={renameAction} className="flex min-w-0 items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="ruleId" value={rule.id} />
        <TextInput
          name="name"
          type="text"
          required
          maxLength={120}
          defaultValue={rule.name}
          aria-label="Rule name"
          className="text-xl font-semibold tracking-tight"
        />
        <Button type="submit" disabled={renaming} tone="text" size="tiny">
          {renaming ? '…' : 'rename'}
        </Button>
        <ActionError state={renameState} />
      </form>

      <div className="flex shrink-0 items-center gap-2">
        <RuleEnabledToggle organizationId={organizationId} rule={rule} />

        <form id={deleteFormId} action={deleteFormAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />
          <ConfirmSubmit
            formId={deleteFormId}
            label="Remove"
            confirmLabel="Remove rule"
            description={`Remove "${rule.name}"? Its conditions and actions go with it. Runs it has already made stay recorded.`}
            tone="secondary"
            size="small"
            pending={deleting}
          />
          <ActionError state={deleteState} />
        </form>
      </div>
    </div>
  );
}
