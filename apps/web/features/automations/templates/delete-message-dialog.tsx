'use client';

import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import type { MessageTemplate } from '@/lib/domain/automation/templates';
import { deleteTemplateAction } from '@/app/organizations/[organizationId]/automations/actions';
import { ActionError, INITIAL_AUTOMATION_ACTION_STATE as INITIAL } from '../shared';

export function DeleteMessageDialog({
  organizationId,
  template,
}: {
  organizationId: string;
  template: MessageTemplate;
}) {
  const [state, formAction, pending] = useActionState(deleteTemplateAction, INITIAL);
  const formId = `delete-template-${template.id}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="templateId" value={template.id} />
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove message"
        description={`Remove "${template.name}"? Any rule using it loses its action.`}
        tone="secondary"
        size="small"
        pending={pending}
      />
      <ActionError state={state} />
    </form>
  );
}
