'use client';

import { useActionState } from 'react';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import {
  changeCustomerStageAction,
  type ChangeStageState,
} from '@/app/organizations/[organizationId]/customers/pipeline/actions';

const INITIAL: ChangeStageState = { error: null };

/**
 * Move one customer to a different stage, from the board rather than their own detail screen.
 *
 * **Calls the FastAPI-authoritative write.** `changeCustomerStageAction` forwards this to
 * `apps/api/app/domains/crm/stages.py::change_customer_stage`, which is the one implementation of
 * *moving a card between pipeline columns* — a different act from `EditCustomerForm`'s bundled
 * edit-and-move, which keeps its own unchanged, atomic write (see that component's own comment).
 *
 * Submits on change rather than needing a Save button: a board with one button per card for
 * every stage select would be forty buttons on a business with forty customers staged.
 */
export function CustomerStageControl({
  organizationId,
  customerId,
  customerName,
  currentStageId,
  stages,
}: {
  organizationId: string;
  customerId: string;
  customerName: string;
  currentStageId: string | null;
  stages: CustomerStage[];
}) {
  const [state, formAction, pending] = useActionState(changeCustomerStageAction, INITIAL);

  return (
    <form action={formAction} className="mt-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customerId} />
      <SelectInput
        name="stageId"
        defaultValue={currentStageId ?? ''}
        disabled={pending}
        aria-label={`Move ${customerName} to a different stage`}
        className="w-full text-xs"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">No stage</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </SelectInput>
      {state.error ? <ErrorText className="text-xs">{state.error}</ErrorText> : null}
    </form>
  );
}
