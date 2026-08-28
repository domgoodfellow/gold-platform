'use client';

import { useActionState, useState } from 'react';
import type { Slot } from '@/lib/domain/booking/booking';
import { bookAction, type BookingActionState } from './actions';

const INITIAL: BookingActionState = { error: null };
const INPUT_CLASS = 'w-full rounded border border-black/15 px-3 py-2 dark:border-white/20';

/**
 * One primary action, which D23 asks of every screen and this one takes literally.
 *
 * Pick a time, say who you are, book. The slot's three values ride along in hidden fields
 * rather than as an index, so the server commits against exactly the offer that was rendered
 * — and finds out from the exclusion constraint if the world moved underneath it (I6).
 */
export function BookingForm({
  organizationId,
  typeId,
  slots,
  timeZone,
}: {
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
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="startsAt" value={chosen?.startsAt ?? ''} />
      <input type="hidden" name="endsAt" value={chosen?.endsAt ?? ''} />
      <input type="hidden" name="resourceId" value={chosen?.resourceId ?? ''} />

      <ul className="flex flex-wrap gap-2">
        {slots.map((slot) => {
          const current = chosen?.startsAt === slot.startsAt;
          return (
            <li key={slot.startsAt}>
              <button
                type="button"
                onClick={() => setChosen(slot)}
                aria-pressed={current}
                className={
                  current
                    ? 'rounded bg-foreground px-3 py-1.5 text-sm text-background'
                    : 'rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20'
                }
              >
                {time.format(new Date(slot.startsAt))}
              </button>
            </li>
          );
        })}
      </ul>

      {chosen ? (
        <div className="flex flex-col gap-2">
          <input name="name" type="text" required placeholder="Your name" className={INPUT_CLASS} />
          {/* Either reaches you, and the domain layer insists on one of them — a booking
              nobody can be contacted about is not a booking. */}
          <input name="email" type="email" placeholder="Email" className={INPUT_CLASS} />
          <input name="phone" type="tel" placeholder="Phone" className={INPUT_CLASS} />

          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          >
            {pending ? 'Booking…' : `Book ${time.format(new Date(chosen.startsAt))}`}
          </button>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
