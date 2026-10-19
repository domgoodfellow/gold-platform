'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
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
  customerId,
  customerName,
  compact = false,
  presentation = 'form',
  onDraftChange,
  formId,
}: {
  organizationId: string;
  /** Numbers that could ring out: active, ready and enabled for outbound calls. */
  numbers: DialableNumber[];
  /** What the server would choose with nothing named, for the first option to say. */
  defaultNumber: DialableNumber | null;
  toNumber?: string;
  phoneNumberId?: string;
  customerId?: string;
  customerName?: string;
  compact?: boolean;
  /**
   * `console` is the Dialer page's calling surface: a large number, the dial pad beside it and no
   * pop-out button of its own, because the page's presentation toolbar owns Pop-out.
   */
  presentation?: 'form' | 'console';
  /** Told every change to the number and the chosen line, so a control outside the form can carry the draft. */
  onDraftChange?: (draft: { toNumber: string; phoneNumberId: string }) => void;
  /** Lets a control outside the form submit it, such as the queue's Start calling. */
  formId?: string;
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
  const onConsole = presentation === 'console' && !compact;
  useEffect(() => {
    if (compact) updateDraft?.({ toNumber, phoneNumberId });
  }, [compact, updateDraft, toNumber, phoneNumberId]);
  useEffect(() => {
    onDraftChange?.({ toNumber, phoneNumberId });
  }, [onDraftChange, toNumber, phoneNumberId]);
  const disabledCall = busy || unavailable || !toNumber || (!defaultNumber && !phoneNumberId);
  const dialPad = (
    <div className={onConsole ? 'mx-auto grid w-full max-w-56 grid-cols-3 gap-1.5 self-start @min-[26rem]:max-w-none' : 'grid grid-cols-3 gap-2'} role="group" aria-label="Dial pad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'].map((digit) => (
        <Button key={digit} type="button" tone="secondary" className={onConsole ? 'h-11 text-base tabular-nums' : 'h-12 text-lg'} disabled={busy} aria-label={`Dial ${digit}`} onClick={() => setToNumber((value) => value + digit)}>{digit}</Button>
      ))}
      <Button type="button" tone="secondary" className={onConsole ? 'h-11' : 'h-12'} aria-label="Delete last digit" disabled={busy || !toNumber} onClick={() => setToNumber((value) => value.slice(0, -1))}><Delete aria-hidden /></Button>
    </div>
  );

  if (!compact && popout?.container) {
    return (
      <div className="space-y-3">
        <Hint>The dialer is open in a separate window.</Hint>
        <Button type="button" tone="secondary" onClick={() => popout.open()}><ExternalLink aria-hidden /> Show dialer</Button>
        <Button type="button" tone="text" onClick={popout.close}>Return to GildOps</Button>
      </div>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || unavailable || (!defaultNumber && !phoneNumberId)) return;
    const matchesCustomer = toNumber === initialToNumber;
    void dial({ toNumber, contactLabel: matchesCustomer ? customerName ?? toNumber : toNumber, customerId: matchesCustomer ? customerId : undefined, phoneNumberId: phoneNumberId || null });
  };

  if (onConsole) {
    return (
      <form id={formId} className="@container mx-auto w-full max-w-xl" onSubmit={submit}>
        <div className="grid gap-4 @min-[26rem]:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-to`}>Number to call</FieldLabel>
              <TextInput id={`${id}-to`} value={toNumber} onChange={(event) => setToNumber(event.target.value)} type="tel" inputMode="tel" required disabled={busy} className="h-11 text-lg font-medium tabular-nums" placeholder="+14165550142" pattern="\+[1-9][0-9]{7,14}" title="With a country code, like +14165550142" />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-from`}>Call from</FieldLabel>
              <SelectInput id={`${id}-from`} value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} disabled={unavailable || busy} className="w-full">
                <option value="" disabled={!defaultNumber}>{defaultNumber ? `My usual number (${defaultNumber.label ?? defaultNumber.e164})` : unavailable ? 'No outbound number' : 'Select a number'}</option>
                {numbers.map((number) => (
                  <option key={number.id} value={number.id}>{number.label ? `${number.label} (${number.e164})` : number.e164}</option>
                ))}
              </SelectInput>
            </div>
            <Button type="submit" className="h-11 w-full text-base" disabled={disabledCall}>
              <Phone aria-hidden /> {dialing ? 'Calling…' : 'Call'}
            </Button>
            {activeCall || incoming ? <Hint>Finish the current call before starting another.</Hint> : null}
            {popout?.error ? <ErrorText>{popout.error}</ErrorText> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </div>
          {dialPad}
        </div>
      </form>
    );
  }

  return (
    <form
      id={formId}
      className="flex flex-col gap-3"
      onSubmit={submit}
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

      {compact ? dialPad : null}
      <Button type="submit" disabled={disabledCall}>
        <Phone aria-hidden /> {dialing ? 'Calling…' : 'Call'}
      </Button>
      {!compact && popout ? <Button type="button" tone="secondary" data-dialer-popout-trigger disabled={dialing} onClick={() => popout.open({ numbers, defaultNumber, toNumber, phoneNumberId, customerId: toNumber === initialToNumber ? customerId : undefined, customerName: toNumber === initialToNumber ? customerName : undefined, onReturn: (draft) => { setToNumber(draft.toNumber); setPhoneNumberId(draft.phoneNumberId); } })}><ExternalLink aria-hidden /> Pop out dialer</Button> : null}
      {activeCall || incoming ? <Hint>Finish the current call before starting another.</Hint> : null}
      {!compact && popout?.error ? <ErrorText>{popout.error}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
