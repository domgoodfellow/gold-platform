'use server';
import { revalidatePath } from 'next/cache';
import { getPortalDb } from '@/lib/db/portal-server';
import { requirePortalRequestContext } from '@/lib/domain/portal/request-context';
import { respondServiceReview } from '@/lib/domain/customers/service-reviews';
import { DomainError } from '@/lib/domain/errors';

export type ReviewResponseState = { error: string | null; saved: boolean };
export async function respondServiceReviewAction(_previous: ReviewResponseState, form: FormData): Promise<ReviewResponseState> {
  const db = await getPortalDb();
  try {
    await requirePortalRequestContext(db);
    await respondServiceReview(db, String(form.get('reviewId') ?? ''), Number(form.get('version')), String(form.get('decision') ?? ''), form.has('description') ? String(form.get('description')) : undefined);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, saved: false };
    return { error: 'Your response could not be recorded. Refresh and try again.', saved: false };
  }
  revalidatePath('/portal', 'layout');
  return { error: null, saved: true };
}
