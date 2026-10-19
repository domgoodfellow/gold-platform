'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useId, useState } from 'react';
import { checkFormAnswers, type FormPublication } from '@gold/schemas';
import { FormFields, type FormErrors, type FormValues } from '@/features/forms/form-renderer';
import type { Slot } from '@/lib/domain/booking/booking';
import { bookAction, type BookingActionState } from './actions';

const INITIAL: BookingActionState = { error: null };
/**
 * One primary action, which the UI system asks of every screen and this one takes literally.
 *
 * Pick a time, say who you are, book. The slot's two values ride along in hidden fields
 * rather than as an index, so the server commits against exactly the offer that was rendered
 * — and finds out from the exclusion constraint if the world moved underneath it.
 */
export function BookingForm({
  slug,
  organizationId,
  typeId,
  slots,
  timeZone,
  intake = null,
}: {
  slug: string;
  organizationId: string;
  typeId: string;
  slots: Slot[];
  timeZone: string;
  /** The business's own questions for this kind of work: the published revision, or null when it asks none. */
  intake?: FormPublication | null;
}) {
  const [state, formAction, pending] = useActionState(bookAction, INITIAL);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [answers, setAnswers] = useState<FormValues>({});
  const [localErrors, setLocalErrors] = useState<FormErrors>({});
  const intakePrefix = useId();
  const fieldErrors: FormErrors = { ...(state.fieldErrors ?? {}), ...localErrors };

  const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone });

  return (
    <form
      action={formAction}
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        // The visitor's own check, for a clearer message sooner; the action and the database check
        // again. A refusal puts the keyboard on the first answer that needs attention.
        if (!intake) return;
        const form = event.currentTarget;
        const checked = checkFormAnswers(intake.definition, answers);
        if (checked.ok) {
          setLocalErrors({});
          return;
        }
        event.preventDefault();
        const { _form, ...problems } = checked.errors;
        void _form;
        setLocalErrors(problems);
        requestAnimationFrame(() => {
          const bad = form.querySelector<HTMLElement>('[aria-invalid="true"]');
          (bad?.matches('fieldset') ? bad.querySelector<HTMLElement>('input, button') : bad)?.focus();
        });
      }}
    >
      {/* Both travel: the slug is where to send them afterwards, and the id is what the
          server commits against. The id was resolved server-side from the slug and is only
          ever accepted here because `create_booking` checks it against the caller's binding —
          a forged one names a business this visitor is not bound to and is refused. */}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="startsAt" value={chosen?.startsAt ?? ''} />
      <input type="hidden" name="endsAt" value={chosen?.endsAt ?? ''} />
      {intake ? (
        <>
          {/* Which questions the visitor saw, so a form edited meanwhile is noticed rather than
              judged against. A customer is never shown that this exists. */}
          <input type="hidden" name="intakeRevisionId" value={intake.revisionId} />
          <input type="hidden" name="intakeAnswers" value={JSON.stringify(answers)} />
        </>
      ) : null}

      <ul className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const current = chosen?.startsAt === slot.startsAt;
          return (
            <li key={slot.startsAt}>
              {/* **The chosen slot takes the business's own colour**, which is the one place
                  on this page a visitor is choosing something rather than reading it. `tone`
                  is exactly the ternary this used to spell out by hand. */}
              <Button
                type="button"
                onClick={() => setChosen(slot)}
                aria-pressed={current}
                tone={current ? 'primary' : 'secondary'}
                size="small"
              >
                {time.format(new Date(slot.startsAt))}
              </Button>
            </li>
          );
        })}
      </ul>

      {chosen ? (
        <div className="flex flex-col gap-2">
          <TextInput
            name="name"
            type="text"
            required
            placeholder="Your name"
            className="w-full"
          />
          {/* Either reaches you, and the domain layer insists on one of them — a booking
              nobody can be contacted about is not a booking. */}
          <TextInput name="email" type="email" placeholder="Email" className="w-full" />
          <PhoneInput name="phone" type="tel" placeholder="Phone" className="w-full" />

          {intake ? (
            <fieldset className="mt-2 flex flex-col gap-4 border-t border-border pt-4" disabled={pending}>
              <legend className="text-sm font-medium">{intake.definition.title}</legend>
              {intake.definition.description ? <Hint>{intake.definition.description}</Hint> : null}
              {/* The same field renderer the hosted form uses, not a booking-shaped copy of it. */}
              <FormFields
                definition={intake.definition}
                idPrefix={intakePrefix}
                values={answers}
                errors={fieldErrors}
                disabled={pending}
                onChange={(fieldId, value) => setAnswers((current) => ({ ...current, [fieldId]: value }))}
              />
            </fieldset>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Booking…' : `Book ${time.format(new Date(chosen.startsAt))}`}
          </Button>
        </div>
      ) : null}

      <ErrorText role="alert">{state.error}</ErrorText>
      {state.stale ? (
        <Button type="button" tone="secondary" size="small" className="w-fit" onClick={() => window.location.reload()}>
          Reload this page
        </Button>
      ) : null}
    </form>
  );
}
