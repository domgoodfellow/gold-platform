'use client';

import { useEffect, useId, useState } from 'react';
import { Delete, ExternalLink, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { useDial } from './use-dial';
import { useDialerPopout } from './dialer-popout-context';
import { useTelephoneDevice } from './telephone-device';

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
  toNumber: initialToNumber = '',
  phoneNumberId: initialPhoneNumberId = '',
  compact = false,
}: {
  organizationId: string;
  /** Numbers that could ring out: active, ready and enabled for outbound calls. */
  numbers: DialableNumber[];
  /** What the server would choose with nothing named, for the first option to say. */
  defaultNumber: DialableNumber | null;
  toNumber?: string;
  phoneNumberId?: string;
  compact?: boolean;
}) {
  const { dial, dialing, error } = useDial(organizationId);
  const { activeCall, incoming } = useTelephoneDevice();
  const popout = useDialerPopout();
  const id = useId();
  const [toNumber, setToNumber] = useState(initialToNumber);
  const [phoneNumberId, setPhoneNumberId] = useState(initialPhoneNumberId);

  const unavailable = numbers.length === 0 && defaultNumber === null;
  const busy = dialing || activeCall !== null || incoming !== null;
  const updateDraft = popout?.updateDraft;
  useEffect(() => {
    if (compact) updateDraft?.({ toNumber, phoneNumberId });
  }, [compact, updateDraft, toNumber, phoneNumberId]);

  if (!compact && popout?.container) {
    return (
      <div className="space-y-3">
        <Hint>The dialer is open in a separate window.</Hint>
        <Button type="button" tone="secondary" onClick={() => popout.open()}><ExternalLink aria-hidden /> Show dialer</Button>
        <Button type="button" tone="text" onClick={popout.close}>Return to GildOps</Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || unavailable || (!defaultNumber && !phoneNumberId)) return;
        void dial({ toNumber, contactLabel: toNumber, phoneNumberId: phoneNumberId || null });
      }}
    >
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-to`}>Number to call</FieldLabel>
        <TextInput
          id={`${id}-to`}
          value={toNumber}
          onChange={(event) => setToNumber(event.target.value)}
          type="tel"
          inputMode="tel"
          required
          disabled={busy}
          className={compact ? 'h-12 text-center text-xl tabular-nums' : undefined}
          placeholder="+14165550142"
          pattern="\+[1-9][0-9]{7,14}"
          title="With a country code, like +14165550142"
        />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-from`}>Call from</FieldLabel>
        <SelectInput id={`${id}-from`} value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} disabled={unavailable || busy}>
          <option value="" disabled={!defaultNumber}>{defaultNumber ? `My usual number (${defaultNumber.label ?? defaultNumber.e164})` : 'Select a number'}</option>
          {numbers.map((number) => (
            <option key={number.id} value={number.id}>{number.label ? `${number.label} (${number.e164})` : number.e164}</option>
          ))}
        </SelectInput>
        {unavailable ? <Hint>Calling is unavailable. Check number assignments and calling setup.</Hint> : null}
      </div>

      {compact ? (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Dial pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'].map((digit) => (
            <Button key={digit} type="button" tone="secondary" className="h-12 text-lg" disabled={busy} aria-label={`Dial ${digit}`} onClick={() => setToNumber((value) => value + digit)}>{digit}</Button>
          ))}
          <Button type="button" tone="secondary" className="h-12" aria-label="Delete last digit" disabled={busy || !toNumber} onClick={() => setToNumber((value) => value.slice(0, -1))}><Delete aria-hidden /></Button>
        </div>
      ) : null}
      <Button type="submit" disabled={busy || unavailable || !toNumber || (!defaultNumber && !phoneNumberId)}>
        <Phone aria-hidden /> {dialing ? 'Calling…' : 'Call'}
      </Button>
      {!compact && popout ? <Button type="button" tone="secondary" data-dialer-popout-trigger disabled={dialing} onClick={() => popout.open({ numbers, defaultNumber, toNumber, phoneNumberId, onReturn: (draft) => { setToNumber(draft.toNumber); setPhoneNumberId(draft.phoneNumberId); } })}><ExternalLink aria-hidden /> Pop out dialer</Button> : null}
      {activeCall || incoming ? <Hint>Finish the current call before starting another.</Hint> : null}
      {!compact && popout?.error ? <ErrorText>{popout.error}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
