'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { organizationHomeHref } from '@/lib/navigation';

export type CreateBusinessState = { error: string | null };

/**
 * Make a business and enter it the way every entry does — a business that has just been created
 * is in SETUP, so `organizationHomeHref` sends it to Setup. Whether this deployment can draft is
 * not part of that: Setup is the map of manual configuration first, and drafting is one optional
 * card on it.
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
      // No currency: the form doesn't ask. The pricing screen asks when an amount is first written.
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // Outside the try — `redirect` works by throwing, so catching around it would turn success into an error.
  redirect(organizationHomeHref(organizationId, 'setup'));
}
