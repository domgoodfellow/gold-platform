'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { createOrganization } from '@/lib/domain/tenancy/organizations';

export type CreateBusinessState = { error: string | null };

/**
 * Make a business, then offer it a starting point: the review screen with no draft waiting shows
 * the published templates and "Start blank". Choosing one opens it as a draft to review; nothing
 * is applied until the owner applies it, and Start blank goes to Setup as before.
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
      // The currency the form showed for confirmation. Empty when the founder chose to decide later; the pricing screen asks when an amount is first written.
      currency: String(formData.get('currency') ?? '') || undefined,
      location: {
        countryCode: String(formData.get('countryCode') ?? ''),
        region: String(formData.get('region') ?? ''),
        city: String(formData.get('city') ?? ''),
        postalCode: String(formData.get('postalCode') ?? ''),
        industry: String(formData.get('industry') ?? ''),
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // Outside the try — `redirect` works by throwing, so catching around it would turn success into an error.
  redirect(`/organizations/${organizationId}/setup/proposal`);
}
