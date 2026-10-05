'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { beginBooking, bookSlot, type Slot } from '@/lib/domain/booking/booking';
import { bookingIntake } from '@/lib/domain/booking/intake';
import { checkAgainst } from '@/lib/domain/forms/public-forms';
import { DomainError } from '@/lib/domain/errors';

export type BookingActionState = {
  error: string | null;
  /** Answers to the business's own questions that the published form refused, by field id. */
  fieldErrors?: Record<string, string>;
  /** The questions changed under the visitor; nothing was booked and the page must reload. */
  stale?: boolean;
};

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
    const typeId = String(formData.get('typeId') ?? '');

    // The business's own questions, if this kind of work asks any. The form is read from the type
    // under this visitor's own binding -- never named by the browser -- and the answers are checked
    // against the revision the visitor was shown. If it is no longer the published one, nothing is
    // booked: the page reloads rather than judging their answers against a form they never saw.
    const intake = await bookingIntake(db, { typeId });
    let answered: { revisionId: string; answers: Record<string, unknown> } | undefined;
    if (intake) {
      if (String(formData.get('intakeRevisionId') ?? '') !== intake.revisionId) {
        return { error: 'This booking was just updated. Please reload the page and book again.', stale: true };
      }
      let raw: unknown;
      try {
        raw = JSON.parse(String(formData.get('intakeAnswers') ?? '{}'));
      } catch {
        raw = {};
      }
      const checked = checkAgainst(intake.definition, raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
      if (!checked.ok) return { error: checked.result.message, fieldErrors: checked.result.fieldErrors };
      answered = { revisionId: intake.revisionId, answers: checked.answers };
    }

    workItemId = await bookSlot(db, {
      organizationId,
      typeId,
      intake: answered,
      slot,
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, stale: error.code === 'booking.intake_stale' };
    throw error;
  }

  redirect(`/book/${slug}/${workItemId}`);
}
