'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { createOrganization } from '@/lib/domain/tenancy/organizations';

export type CreateOrganizationState = { error: string | null };

/**
 * A caller. It reads the form, hands the domain a name, and turns a DomainError into
 * something the page can render. It decides nothing: the trimming, the length rule, and
 * the creator's role all live in the domain, so the AI tool that creates an organization
 * later gets the same behaviour without this file being involved.
 */
export async function createOrganizationAction(
  _previous: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const db = await getDb();

  try {
    await createOrganization(db, {
      name: String(formData.get('name') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      // The zone this business thinks in. Submitted by the browser rather than typed,
      // because the founder is nearly always in it — and validated against
      // `pg_timezone_names` in the database, so a forged value is refused there rather than
      // here (I9).
      timezone: String(formData.get('timezone') ?? ''),
      // Required, and typed by the founder: there is no neutral currency for the platform to
      // pick, and no locale API that answers what a business trades in.
      currency: String(formData.get('currency') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath('/organizations');
  return { error: null };
}
