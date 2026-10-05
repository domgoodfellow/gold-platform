'use client';

import { useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { useDial } from './use-dial';

export type DialableNumber = { id: string; e164: string; label: string | null };

/**
 * Start a call to any number. The number it rings from is the one the server resolves for this
 * person — their own, then their default, then the business's — unless they name another of their
 * own, which the server checks again. The customer, when the number belongs to exactly one, is
 * linked by the database; an unknown number is simply a call.
 */
export function NewCallForm({
  organizationId,
  numbers,
  defaultNumber,
}: {
  organizationId: string;
  /** Numbers that could ring out: active, ready and enabled for outbound calls. */
  numbers: DialableNumber[];
  /** What the server would choose with nothing named, for the first option to say. */
  defaultNumber: DialableNumber | null;
}) {
  const { dial, dialing, error } = useDial(organizationId);
  const [toNumber, setToNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');

  const unavailable = numbers.length === 0 && defaultNumber === null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void dial({ toNumber, contactLabel: toNumber, phoneNumberId: phoneNumberId || null });
      }}
    >
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="new-call-to">Number to call</FieldLabel>
        <TextInput
          id="new-call-to"
          value={toNumber}
          onChange={(event) => setToNumber(event.target.value)}
          type="tel"
          inputMode="tel"
          required
          placeholder="+14165550142"
          pattern="\+[1-9][0-9]{7,14}"
          title="With a country code, like +14165550142"
        />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="new-call-from">Call from</FieldLabel>
        <SelectInput id="new-call-from" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} disabled={unavailable}>
          <option value="">{defaultNumber ? `My usual number (${defaultNumber.label ?? defaultNumber.e164})` : 'No number set up'}</option>
          {numbers.map((number) => (
            <option key={number.id} value={number.id}>{number.label ? `${number.label} (${number.e164})` : number.e164}</option>
          ))}
        </SelectInput>
        {unavailable ? <Hint>There is no number to call from yet. Assign one under Numbers.</Hint> : null}
      </div>

      <Button type="submit" disabled={dialing || unavailable || !toNumber}>
        <Phone aria-hidden /> {dialing ? 'Calling…' : 'Call'}
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
