'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, SelectInput, TextInput } from '@/components/controls/inputs';
import { CustomFieldInputs } from '@/components/custom-fields/inputs';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { editCustomerAction, type EditCustomerState } from './actions';
import { placeCallAction, recordCallAction, type FormState } from '../../calls/actions';

const EDIT_INITIAL: EditCustomerState = { error: null };
const CALL_INITIAL: FormState = { error: null };

/**
 * Correcting a customer, and moving them along.
 *
 * **The stage selector is here rather than on a board of its own**, because moving a
 * relationship is something somebody does while looking at the person, not while looking at a
 * pipeline. A board is a way of reading the same column and it can be built later; this is the
 * write.
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

/**
 * Ring them, or write down that somebody already did.
 *
 * **Two buttons on one form, and they are two different acts.** Placing a call asks the carrier
 * to ring and fails loudly on a deployment that has none. Recording one is a person saying what
 * happened on their mobile. Collapsing them would mean a button that sometimes dials and
 * sometimes does not, which is the dead end D31 names.
 */
export function CallCustomerForm({
  organizationId,
  customerId,
  phone,
}: {
  organizationId: string;
  customerId: string;
  phone: string | null;
}) {
  const [placeState, placeAction, placing] = useActionState(placeCallAction, CALL_INITIAL);
  const [recordState, recordAction, recording] = useActionState(recordCallAction, CALL_INITIAL);

  return (
    <div className="mt-2 flex flex-col gap-3">
      <form action={placeAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="customerId" value={customerId} />
        <TextInput
          name="toNumber"
          type="tel"
          required
          defaultValue={phone ?? ''}
          placeholder="+14165550142"
          aria-label="Number to call"
          className="flex-1"
        />
        <Button type="submit" disabled={placing}>
          Call
        </Button>
      </form>

      {placeState.error ? <ErrorText>{placeState.error}</ErrorText> : null}

      <form action={recordAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="customerId" value={customerId} />
        <SelectInput name="direction" defaultValue="outbound" aria-label="Which way">
          <option value="outbound">We called them</option>
          <option value="inbound">They called us</option>
        </SelectInput>
        <TextInput
          name="fromNumber"
          type="tel"
          required
          placeholder="From, e.g. +14165550100"
          aria-label="From"
          className="flex-1"
        />
        <TextInput
          name="toNumber"
          type="tel"
          required
          defaultValue={phone ?? ''}
          placeholder="To"
          aria-label="To"
          className="flex-1"
        />
        <Button type="submit" tone="secondary" disabled={recording}>
          Write it down
        </Button>
      </form>

      {recordState.error ? <ErrorText>{recordState.error}</ErrorText> : null}
    </div>
  );
}
