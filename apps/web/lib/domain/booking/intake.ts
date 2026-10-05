import { FormDefinitionSchema, FormPublicationSchema, type FormDefinition, type FormPublication } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { listForms } from '@/lib/domain/forms/forms';
import { DomainError } from '@/lib/domain/errors';

/**
 * A booking's own questions. Booking owns the booking — service, slot, resources, price, status;
 * Forms owns the questions, their validation and their revisions. The two meet at one reference:
 * a bookable type may name one of its business's forms, and the public booking page asks that
 * form's published revision beside the name and contact fields Booking needs for itself.
 *
 * This file holds the reference and the two readers. The answers are *written* by `create_booking`,
 * in the booking's own transaction, never by a second call from here.
 */

/** What a visitor is asked for one bookable type: the published revision, or null when it asks nothing. */
export async function bookingIntake(db: Db, input: { typeId: string }): Promise<FormPublication | null> {
  const { data, error } = await db.rpc('booking_intake_available', { p_type_id: input.typeId });
  if (error) throw new DomainError(error.message, 'booking.intake_failed');
  return data ? FormPublicationSchema.parse(data) : null;
}

/**
 * The forms a booking may ask: published and not archived — what the database will accept. Reading
 * the list takes the authority that governs forms, so somebody without it is offered none rather
 * than an error on a screen that is otherwise theirs.
 */
export async function listBookingIntakeForms(db: Db, input: { organizationId: string }): Promise<Array<{ id: string; name: string }>> {
  try {
    const forms = await listForms(db, input.organizationId);
    return forms.filter((form) => !form.archived && form.publishedRevisionNumber !== null).map((form) => ({ id: form.id, name: form.name }));
  } catch {
    return [];
  }
}

/** Ask a form at booking, or stop asking (`formId: null`). The database refuses a form that is archived, unpublished or another business's. */
export async function setTypeBookingIntake(db: Db, input: { typeId: string; formId: string | null }): Promise<void> {
  const { error } = await db.rpc('set_type_booking_intake', { p_type_id: input.typeId, p_form_id: input.formId as string });
  if (error) {
    if (error.code === 'GD016' || error.code === '23503') {
      throw new DomainError('Choose a form of this business that is published and not archived.', 'booking.intake_form_invalid');
    }
    if (error.code === '23514') {
      throw new DomainError('Publish this kind of work for booking before it asks questions.', 'booking.intake_needs_booking');
    }
    if (error.code === '42501') throw new DomainError('You cannot change what this booking asks.', 'booking.intake_forbidden');
    throw new DomainError(error.message, 'booking.intake_config_failed');
  }
}

export type BookingIntakeResponse = {
  submissionId: string;
  formId: string;
  formName: string;
  submittedAt: string;
  revisionId: string;
  revisionNumber: number;
  definition: FormDefinition;
  answers: Record<string, unknown>;
};

/** Which response belongs to this booking — read with the same authority as the responses screen. */
export async function workItemIntake(db: Db, input: { organizationId: string; workItemId: string }): Promise<BookingIntakeResponse | null> {
  const { data, error } = await db.rpc('work_item_intake', { p_organization_id: input.organizationId, p_work_item_id: input.workItemId });
  if (error) {
    if (error.code === '42501') return null;
    throw new DomainError(error.message, 'booking.intake_read_failed');
  }
  if (!data) return null;
  const raw = data as unknown as BookingIntakeResponse;
  return { ...raw, definition: FormDefinitionSchema.parse(raw.definition) };
}
