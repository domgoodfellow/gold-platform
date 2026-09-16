'use client';

import { useActionState } from 'react';
import { EmptyState, GroupHeading } from '@/components/containers/section';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { ACTION_KINDS, type AutomationRule } from '@/lib/domain/automation/rules';
import { CHANNELS, type MessageTemplate } from '@/lib/domain/automation/templates';
import type { StatusChoice } from './rule-detail-types';
import { removeActionAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';
import { describeMinutes } from './trigger';
import { AddActionSheet } from './add-action-sheet';

/** What one action does, in the words the business would use for it. */
function describeAction(
  action: AutomationRule['actions'][number],
  statuses: StatusChoice[],
  templates: MessageTemplate[],
): string {
  if (action.kind === 'create_work_item') {
    const status = statuses.find((entry) => entry.id === action.statusId)?.label ?? 'a status that is no longer here';
    return `starting at ${status}, titled with this rule's name`;
  }

  if (action.kind === 'notify') {
    const template = templates.find((entry) => entry.id === action.templateId)?.name ?? 'a message that is no longer here';
    const channel = CHANNELS.find((entry) => entry.channel === action.channel)?.label ?? '';
    return `${template} ${channel}`;
  }

  if (action.kind === 'shift_schedule') {
    const minutes = action.shiftMinutes ?? 0;
    return `${describeMinutes(Math.abs(minutes))} ${minutes < 0 ? 'earlier' : 'later'}`;
  }

  return statuses.find((status) => status.id === action.statusId)?.label ?? 'a status that is no longer here';
}

/**
 * The THEN section of a rule's detail page. Actions can be added and removed only — the domain
 * layer has no update, so there is no Edit control here to invent one.
 */
export function ActionList({
  organizationId,
  rule,
  statuses,
  templates,
  types,
  mayManage,
}: {
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
  mayManage: boolean;
}) {
  return (
    <section>
      <GroupHeading>Then</GroupHeading>

      {rule.actions.length === 0 ? (
        <EmptyState className="mt-1">
          Nothing yet, so this rule does nothing. It is watching and will keep watching.
        </EmptyState>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {rule.actions.map((action) => (
            <li key={action.id} className="flex items-center gap-2 text-sm">
              <span>
                {ACTION_KINDS.find((entry) => entry.kind === action.kind)?.label ?? action.kind}{' '}
                {describeAction(action, statuses, templates)}
              </span>
              {mayManage ? (
                <RemoveAction organizationId={organizationId} ruleId={rule.id} actionId={action.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayManage ? (
        <div className="mt-2">
          <AddActionSheet
            organizationId={organizationId}
            rule={rule}
            statuses={statuses}
            templates={templates}
            types={types}
          />
        </div>
      ) : null}
    </section>
  );
}

function RemoveAction({
  organizationId,
  ruleId,
  actionId,
}: {
  organizationId: string;
  ruleId: string;
  actionId: string;
}) {
  const [state, formAction, pending] = useActionState(removeActionAction, INITIAL);
  const formId = `remove-action-${actionId}`;

  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <input type="hidden" name="actionId" value={actionId} />
      <ConfirmSubmit
        formId={formId}
        label="remove"
        confirmLabel="Remove action"
        description="Remove this action from the rule?"
        tone="text"
        size="tiny"
        pending={pending}
      />
      <ActionError state={state} />
    </form>
  );
}
