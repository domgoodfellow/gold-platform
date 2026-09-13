'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  placeCallAction,
  recordCallAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';

const CALL_INITIAL: FormState = { error: null };

/**
 * Ring them, or write down that somebody already did.
 *
 * **Two buttons on one form, and they are two different acts.** Placing a call asks the carrier
 * to ring and fails loudly on a deployment that has none. Recording one is a person saying what
 * happened on their mobile. Collapsing them would mean a button that sometimes dials and
 * sometimes does not, which is the dead end D31 names.
 *
 * Composed by the customer detail page (CRM's own "related communications" surface), but the
 * capability itself belongs to Communications/Voice — this is what CRM consuming Voice without
 * defining it looks like on the customer side of the boundary.
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
