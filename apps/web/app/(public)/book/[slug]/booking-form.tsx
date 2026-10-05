'use client';

import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useState } from 'react';
import type { Slot } from '@/lib/domain/booking/booking';
import { bookAction, type BookingActionState } from './actions';

const INITIAL: BookingActionState = { error: null };
/**
 * One primary action, which D23 asks of every screen and this one takes literally.
 *
 * Pick a time, say who you are, book. The slot's two values ride along in hidden fields
 * rather than as an index, so the server commits against exactly the offer that was rendered
 * — and finds out from the exclusion constraint if the world moved underneath it (I6).
 */
export function BookingForm({
  slug,
  organizationId,
  typeId,
  slots,
  timeZone,
}: {
  slug: string;
  organizationId: string;
  typeId: string;
  slots: Slot[];
  timeZone: string;
}) {
  const [state, formAction, pending] = useActionState(bookAction, INITIAL);
  const [chosen, setChosen] = useState<Slot | null>(null);

  const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone });

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      {/* Both travel: the slug is where to send them afterwards, and the id is what the
          server commits against. The id was resolved server-side from the slug and is only
          ever accepted here because `create_booking` checks it against the caller's binding —
          a forged one names a business this visitor is not bound to and is refused. */}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="startsAt" value={chosen?.startsAt ?? ''} />
      <input type="hidden" name="endsAt" value={chosen?.endsAt ?? ''} />

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
          <TextInput name="phone" type="tel" placeholder="Phone" className="w-full" />

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Booking…' : `Book ${time.format(new Date(chosen.startsAt))}`}
          </Button>
        </div>
      ) : null}

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
