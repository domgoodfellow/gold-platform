'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import {
  recordCallAction,
  type FormState,
} from '@/app/organizations/[organizationId]/calls/actions';
import { useDial } from './use-dial';

const CALL_INITIAL: FormState = { error: null };

/**
 * Ring them, or write down that somebody already did.
 *
 * **Two buttons on one form, and they are two different acts.** Placing a call asks the carrier
 * to ring and fails loudly on a deployment that has none. Recording one is a person saying what
 * happened on their mobile. Collapsing them would mean a button that sometimes dials and
 * sometimes does not, which is the dead end the no-dead-end rule names.
 *
 * **"Call" does two things in sequence rather than one.** `useDial` rings the number into a
 * room and then joins the agent's own browser to that same room through `TelephoneDeviceProvider`,
 * which is the half that used to be missing — a conference with a customer in it and nobody
 * representing the business.
 *
 * Composed by the customer detail page (CRM's own "related communications" surface), but the
 * capability itself belongs to Communications/Voice — this is what CRM consuming Voice without
 * defining it looks like on the customer side of the boundary.
 */
export function CallCustomerForm({
  organizationId,
  customerId,
  customerName,
  phone,
}: {
  organizationId: string;
  customerId: string;
  customerName: string;
  phone: string | null;
}) {
  const { dial, dialing, error: dialError } = useDial(organizationId);
  const [recordState, recordAction, recording] = useActionState(recordCallAction, CALL_INITIAL);
  const [toNumber, setToNumber] = useState(phone ?? '');

  const call = () => dial({ toNumber, customerId, contactLabel: customerName });

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <PhoneInput
          value={toNumber}
          onChange={(event) => setToNumber(event.target.value)}
          type="tel"
          required
          placeholder="+14165550142"
          aria-label="Number to call"
          className="flex-1"
        />
        <Button type="button" onClick={() => void call()} disabled={dialing || !toNumber}>
          Call
        </Button>
      </div>

      {dialError ? <ErrorText>{dialError}</ErrorText> : null}

      <form action={recordAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="customerId" value={customerId} />
        <SelectInput name="direction" defaultValue="outbound" aria-label="Which way">
          <option value="outbound">We called them</option>
          <option value="inbound">They called us</option>
        </SelectInput>
        <PhoneInput
          name="fromNumber"
          type="tel"
          required
          placeholder="From, e.g. +14165550100"
          aria-label="From"
          className="flex-1"
        />
        <PhoneInput
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
