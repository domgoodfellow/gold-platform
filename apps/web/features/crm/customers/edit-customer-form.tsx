'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, SelectInput, TextInput } from '@/components/controls/inputs';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  editCustomerAction,
  type EditCustomerState,
} from '@/app/organizations/[organizationId]/customers/[customerId]/actions';

const EDIT_INITIAL: EditCustomerState = { error: null };

/**
 * Correcting a customer, and moving them along.
 *
 * **The stage selector is here rather than on a board of its own**, because moving a
 * relationship is something somebody does while looking at the person, not while looking at a
 * pipeline. `features/crm/sales/pipeline-board.tsx` is that board, with its own stage control
 * calling a different, FastAPI-authoritative write (`apps/api/app/domains/crm/stages.py`) — this
 * form keeps the one it already had, `updateCustomer`, unchanged: correcting a name, an email,
 * a phone number and a stage together remains one act, and splitting it here to route the stage
 * field through a second network call would trade the atomic write this form has always made for
 * two requests that can now fail independently of each other, which is a regression this
 * extraction must not introduce.
 *
 * `stages` is empty for a business that has named none, and the selector then offers only *No
 * stage* — which is the platform saying nothing rather than proposing a pipeline.
 */
export function EditCustomerForm({
  organizationId,
  customer,
  definitions,
  stages,
}: {
  organizationId: string;
  customer: Customer;
  definitions: FieldDefinition[];
  stages: CustomerStage[];
}) {
  const [state, formAction, pending] = useActionState(editCustomerAction, EDIT_INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customer.id} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={customer.name}
          aria-label="Name"
          className="flex-1"
        />
        <TextInput
          name="email"
          type="email"
          maxLength={320}
          defaultValue={customer.email ?? ''}
          aria-label="Email"
          className="flex-1"
        />
        <TextInput
          name="phone"
          type="tel"
          maxLength={50}
          defaultValue={customer.phone ?? ''}
          aria-label="Phone"
          className="flex-1"
        />
      </div>

      {stages.length > 0 ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="stageId">Stage</FieldLabel>
          <SelectInput
            id="stageId"
            name="stageId"
            defaultValue={customer.stageId ?? ''}
            className="w-fit"
          >
            <option value="">No stage</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </SelectInput>
        </div>
      ) : (
        // The selector is absent rather than empty. A business that has named no stages is not
        // missing a control, and an empty dropdown would be the screen asking a question the
        // business has not been given a way to answer.
        <input type="hidden" name="stageId" value="" />
      )}

      <CustomFieldInputs definitions={definitions} values={customer.custom} />

      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}
