'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { resolveBookingSlug } from '@/lib/domain/booking/booking';
import { cancelBooking, rescheduleBooking } from '@/lib/domain/booking/changes';
import { DomainError } from '@/lib/domain/errors';

export type ChangeActionState = { error: string | null };

/**
 * A customer's own changes. Nothing the browser sends is authority: the business is resolved from the
 * slug, and *whose* booking it is — and whether the business's limits still allow the change — is the
 * database's, from the visitor's own session.
 */
export async function cancelBookingAction(_previous: ChangeActionState, formData: FormData): Promise<ChangeActionState> {
  const db = await getDb();
  const slug = String(formData.get('slug') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');
  try {
    await cancelBooking(db, { workItemId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  redirect(`/book/${slug}/${workItemId}`);
}

export async function rescheduleBookingAction(_previous: ChangeActionState, formData: FormData): Promise<ChangeActionState> {
  const db = await getDb();
  const slug = String(formData.get('slug') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');
  try {
    const organizationId = await resolveBookingSlug(db, slug);
    if (!organizationId) return { error: 'This booking page is not available right now.' };
    await rescheduleBooking(db, { organizationId, workItemId, startsAt: String(formData.get('startsAt') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  redirect(`/book/${slug}/${workItemId}`);
}
