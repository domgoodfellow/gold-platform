'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { bookSlot, type Slot } from '@/lib/domain/booking/booking';
import { DomainError } from '@/lib/domain/errors';

export type BookingActionState = { error: string | null };

/**
 * Take the slot.
 *
 * The slot travels back as the three values the offer was computed from, rather than as an
 * index into a list the server would have to recompute — recomputing it would be a second
 * availability answer, and the first thing to diverge from it would be this page.
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
    resourceId: String(formData.get('resourceId') ?? ''),
  };

  let workItemId: string;
  try {
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
