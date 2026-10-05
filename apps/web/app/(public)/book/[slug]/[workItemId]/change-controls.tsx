'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import type { Slot } from '@/lib/domain/booking/booking';
import { cancelBookingAction, rescheduleBookingAction, type ChangeActionState } from './actions';

const INITIAL: ChangeActionState = { error: null };

export function CancelBookingControl({ slug, workItemId }: { slug: string; workItemId: string }) {
  const [state, formAction, pending] = useActionState(cancelBookingAction, INITIAL);
  const formId = useId();
  return (
    <form id={formId} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <ConfirmSubmit
        formId={formId}
        label="Cancel this booking"
        confirmLabel="Yes, cancel it"
        description="Your appointment will be cancelled and the time given back."
        pending={pending}
        className="w-fit"
      />
      {state.error ? <span role="alert" className="text-sm text-danger">{state.error}</span> : null}
    </form>
  );
}

export function RescheduleSlots({ slug, workItemId, slots, timeZone }: { slug: string; workItemId: string; slots: Slot[]; timeZone: string }) {
  const [state, formAction, pending] = useActionState(rescheduleBookingAction, INITIAL);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone });
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="startsAt" value={chosen?.startsAt ?? ''} />
      <ul className="flex flex-wrap gap-2">
        {slots.map((slot) => (
          <li key={slot.startsAt}>
            <Button
              type="button"
              onClick={() => setChosen(slot)}
              aria-pressed={chosen?.startsAt === slot.startsAt}
              tone={chosen?.startsAt === slot.startsAt ? 'primary' : 'secondary'}
              size="small"
            >
              {time.format(new Date(slot.startsAt))}
            </Button>
          </li>
        ))}
      </ul>
      {chosen ? (
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Moving…' : `Move my booking to ${time.format(new Date(chosen.startsAt))}`}
        </Button>
      ) : null}
      {state.error ? <span role="alert" className="text-sm text-danger">{state.error}</span> : null}
    </form>
  );
}
