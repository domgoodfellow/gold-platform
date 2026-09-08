'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { canDraftConfiguration } from '@/lib/domain/configuration/proposals';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { AREAS, areaHref } from '@/lib/navigation';

export type CreateBusinessState = { error: string | null };

/**
 * Make a business and land on guided setup rather than an empty schedule — unless this
 * deployment can't draft, in which case setup would just say so, and the operational area
 * is the better first screen (D31).
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
  redirect(
    areaHref(organizationId, (await canDraftConfiguration()) ? 'setup' : AREAS[0].segment),
  );
}
