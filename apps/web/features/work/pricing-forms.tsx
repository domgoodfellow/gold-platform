'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/controls/form';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import {
  removePricedLineAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function RemovePricedLineForm({ organizationId, workItemId, lineId, description }: {
  organizationId: string;
  workItemId: string;
  lineId: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(removePricedLineAction, INITIAL);
  const formId = `remove-priced-line-${lineId}`;
  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="lineId" value={lineId} />
      <ConfirmSubmit formId={formId} label="Remove" confirmLabel="Remove line" description={`Remove "${description}" from this quote?`} ariaLabel={`Remove ${description}`} tone="text" size="tiny" pending={pending} />
      <FormError className="ml-2 inline text-xs">{state.error}</FormError>
    </form>
  );
}
