'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Delete, Grid3x3, Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel } from '@/components/controls/inputs';
import { useDial } from './use-dial';
import { useDialerPopout } from './dialer-popout-context';
import { useTelephoneDevice } from './telephone-device';
import { SelectField } from '@/components/controls/select-field';

export type DialableNumber = { id: string; e164: string; label: string | null };

/**
 * Start a call. The form owns the two things a call is placed with, the number to ring and the
 * line to ring from, wherever it is drawn: the Dialer's calling workspace or the pop-out window.
 *
 * **The line.** With nothing named, the server resolves it for this person: their own number, then
 * their default, then the business's. Naming another of their own is checked again by the server.
 * The first option always says what that resolution is, so the line a call will use is stated
 * once, here, before dialing. The options are whatever the server reports as eligible; this form
 * adds no selection rule of its own.
 *
 * **The number.** With `destination="contact"` the number is the selected contact's and is shown,
 * not edited; `onChangeNumber` is how the operator asks for manual entry instead. Otherwise the
 * number is typed, with a keypad on request.
 *
 * **Attribution follows the number.** A call is tied to a contact only while the number being
 * dialed is the one that contact was resolved from; any other number is simply a call.
 */
export function NewCallForm({
  organizationId,
  numbers,
  defaultNumber,
  toNumber: initialToNumber = '',
  phoneNumberId: initialPhoneNumberId = '',
  customerId,
  customerName,
  resolvedContact,
  presentation = 'console',
  destination = 'entry',
  onChangeNumber,
  numberStatus,
  onDraftChange,
  onDial,
  formId,
  blockedReason,
  blockedDescriptionId,
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
  resolvedContact?: { id: string; name: string; number: string };
  /** `window` is the pop-out: it reports each edit to the window's draft and opens with its keypad out. */
  presentation?: 'console' | 'window';
  /** `contact` shows the number instead of a field to type one in. */
  destination?: 'entry' | 'contact';
  /** Offered beside a contact's number: switch to typing a different one. */
  onChangeNumber?: () => void;
  /** What the typed number resolved to, said under the field. */
  numberStatus?: ReactNode;
  /** Told every change to the number and the chosen line, so a control outside the form can carry the draft. */
  onDraftChange?: (draft: { toNumber: string; phoneNumberId: string }) => void;
  /** Told who a call is being placed to, the moment it is placed. */
  onDial?: (contact: { id: string; name: string } | null) => void;
  formId?: string;
  /** A server-resolved blocker; whoever draws it owns its visible description. */
  blockedReason?: string;
  blockedDescriptionId?: string;
}) {
  const { dial, dialing, error } = useDial(organizationId);
  const { activeCall, incoming } = useTelephoneDevice();
  const popout = useDialerPopout();
  const id = useId();
  const inWindow = presentation === 'window';
  const [toNumber, setToNumber] = useState(initialToNumber);
  const [phoneNumberId, setPhoneNumberId] = useState(initialPhoneNumberId);
  const [keypad, setKeypad] = useState(inWindow);

  const unavailable = numbers.length === 0 && defaultNumber === null;
  const busy = dialing || activeCall !== null || incoming !== null;
  const fixed = destination === 'contact';
  const updateDraft = popout?.updateDraft;
  useEffect(() => {
    if (inWindow) updateDraft?.({ toNumber, phoneNumberId });
  }, [inWindow, updateDraft, toNumber, phoneNumberId]);
  useEffect(() => {
    onDraftChange?.({ toNumber, phoneNumberId });
  }, [onDraftChange, toNumber, phoneNumberId]);

  const noLine = !defaultNumber && !phoneNumberId;
  const disabledCall = busy || !!blockedReason || unavailable || !toNumber || noLine;
  const disabledReason = blockedReason
    ?? (unavailable ? 'No outbound line is available.'
      : !toNumber ? (fixed ? null : 'Enter a number to call.')
      : noLine ? 'Choose an outbound line.'
      : busy && !dialing ? 'Finish the current call before starting another.'
      : null);
  const ownsReason = !!disabledReason && !(blockedReason && blockedDescriptionId);
  // A contact with no number says so where the number would be, whatever else is blocking the call.
  const missingNumber = fixed && !toNumber;
  const descriptionId = blockedReason && blockedDescriptionId ? blockedDescriptionId : ownsReason ? `${id}-call-reason` : missingNumber ? `${id}-no-number` : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabledCall) return;
    const matchesCustomer = toNumber === initialToNumber;
    const matched = resolvedContact?.number === toNumber ? resolvedContact : null;
    const contact = matched ? { id: matched.id, name: matched.name } : matchesCustomer && customerId ? { id: customerId, name: customerName ?? toNumber } : null;
    onDial?.(contact);
    void dial({ toNumber, contactLabel: contact?.name ?? toNumber, customerId: contact?.id, phoneNumberId: phoneNumberId || null });
  };

  const line = (number: DialableNumber) => number.label ? `${number.label} (${formatPhoneForDisplay(number.e164)})` : formatPhoneForDisplay(number.e164);

  return (
    <form id={formId} data-destination={destination} className="@container flex w-full flex-col gap-4" onSubmit={submit}>
      {fixed ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {missingNumber
            ? <p id={`${id}-no-number`} className="text-sm text-muted">No phone number is recorded for this contact.</p>
            : <p data-slot="destination-number" className="text-2xl font-semibold tabular-nums tracking-tight">{formatPhoneForDisplay(toNumber)}</p>}
          {onChangeNumber ? <Button type="button" tone="secondary" size="small" disabled={busy} onClick={onChangeNumber}>Dial another number</Button> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-to`}>Number to call</FieldLabel>
          <div className="flex gap-2">
            <PhoneInput id={`${id}-to`} value={toNumber} onChange={(event) => setToNumber(event.target.value)} type="tel" inputMode="tel" required disabled={busy} className="h-11 min-w-0 flex-1 text-lg font-medium tabular-nums" placeholder="+14165550142" pattern="\+[1-9][0-9]{7,14}" title="With a country code, like +14165550142" />
            <Button type="button" tone="secondary" className="h-11 shrink-0" aria-pressed={keypad} aria-expanded={keypad} aria-controls={`${id}-pad`} onClick={() => setKeypad((open) => !open)}>
              <Grid3x3 aria-hidden /> Keypad
            </Button>
          </div>
          {numberStatus}
        </div>
      )}

      {keypad && !fixed ? (
        <div id={`${id}-pad`} role="group" aria-label="Dial pad" className="grid w-full max-w-64 grid-cols-3 gap-1.5 self-center">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'].map((digit) => (
            <Button key={digit} type="button" tone="secondary" className="h-11 text-base tabular-nums" disabled={busy} aria-label={`Dial ${digit}`} onClick={() => setToNumber((value) => value + digit)}>{digit}</Button>
          ))}
          <Button type="button" tone="secondary" className="h-11" aria-label="Delete last digit" disabled={busy || !toNumber} onClick={() => setToNumber((value) => value.slice(0, -1))}><Delete aria-hidden /></Button>
        </div>
      ) : null}

      <div className="grid gap-3 @min-[28rem]:grid-cols-[minmax(0,1fr)_auto] @min-[28rem]:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel htmlFor={`${id}-from`}>Call from</FieldLabel>
          <SelectField
            id={`${id}-from`}
            value={phoneNumberId}
            onValueChange={(next) => setPhoneNumberId(next)}
            disabled={unavailable || busy}
            className="h-11 w-full"
            options={[
              { value: '', label: defaultNumber ? `My usual number (${defaultNumber.label ?? formatPhoneForDisplay(defaultNumber.e164)})` : unavailable ? 'No outbound number' : 'Select a number', disabled: !defaultNumber },
              ...numbers.map((number) => ({ value: number.id, label: line(number) })),
            ]}
          />
        </div>
        <Button type="submit" className="h-11 w-full px-8 text-base @min-[28rem]:w-auto" disabled={disabledCall} aria-describedby={descriptionId}>
          <Phone aria-hidden /> {dialing ? 'Calling…' : 'Call'}
        </Button>
      </div>
      {ownsReason ? <p id={descriptionId} className="text-sm text-muted">{disabledReason}</p> : null}
      {error ? <ErrorText role="alert">{error}</ErrorText> : null}
    </form>
  );
}
