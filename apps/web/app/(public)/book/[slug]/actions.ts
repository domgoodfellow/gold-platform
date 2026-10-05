'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { beginBooking, bookSlot, type Slot } from '@/lib/domain/booking/booking';
import { DomainError } from '@/lib/domain/errors';

export type BookingActionState = { error: string | null };

/**
 * Take the slot.
 *
 * The slot travels back as the two values the offer was computed from — a time. Who takes part is
 * the server's to work out again at the moment of booking, never something this form names.
 *
 * A failure here is ordinary rather than exceptional: the whole of I6 is that the answer this
 * form was built from may be stale by the time it is submitted, so `booking.slot_taken` is a
 * sentence a visitor reads, not an error anybody needs to investigate.
 */
export async function bookAction(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const db = await getDb();
  const slug = String(formData.get('slug') ?? '');
  const organizationId = String(formData.get('organizationId') ?? '');

  const slot: Slot = {
    startsAt: String(formData.get('startsAt') ?? ''),
    endsAt: String(formData.get('endsAt') ?? ''),
  };

  let workItemId: string;
  try {
    // The page binds a visitor while it renders, but a Server Component cannot set cookies, so that
    // session is gone by the time the form arrives. A Server Action can — and binding is harmless to
    // repeat (the unique index makes the second a no-op) — so the booking establishes its own.
    await beginBooking(db, { organizationId });
    workItemId = await bookSlot(db, {
      organizationId,
      typeId: String(formData.get('typeId') ?? ''),
      slot,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  redirect(`/book/${slug}/${workItemId}`);
}
