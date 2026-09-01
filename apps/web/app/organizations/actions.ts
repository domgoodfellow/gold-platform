'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';

export type CreateBusinessState = { error: string | null };

/**
 * Found a business and go straight into it.
 *
 * **The redirect is the point of the whole slice.** Somebody who has just made a business should
 * be looking at it a second later, not back on a list with one row. That is also what makes the
 * previous state so bad by comparison: the page they were sent to had nothing on it and nowhere
 * to go.
 */
export async function createBusinessAction(
  _previous: CreateBusinessState,
  formData: FormData,
): Promise<CreateBusinessState> {
  const db = await getDb();

  let organizationId: string;

  try {
    organizationId = await createOrganization(db, {
      name: String(formData.get('name') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      currency: String(formData.get('currency') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // Outside the try: `redirect` works by throwing, so catching around it would turn a successful
  // creation into an error message. The same shape every other redirecting action here uses.
  redirect(areaHref(organizationId, AREAS[0].segment));
}
