'use server';

import { revalidatePlatform } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { provisionOrganization } from '@/lib/domain/platform/provision';

export type ProvisionState = { error: string | null; provisioned: string | null };

/**
 * A caller. It reads the form, hands the domain what it typed, and turns a `DomainError` into a
 * sentence. It decides nothing — the normalisation, the founding role, and who may do this at
 * all live below it, so the AI onboarding flow that provisions later gets the same behaviour
 * without this file being involved.
 */
export async function provisionOrganizationAction(
  _previous: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const db = await getDb();

  const name = String(formData.get('name') ?? '');

  try {
    await provisionOrganization(db, {
      ownerEmail: String(formData.get('ownerEmail') ?? ''),
      name,
      displayName: String(formData.get('displayName') ?? ''),
      // Not the staff member's browser zone. See `provision.ts` — this business's clock is
      // a fact about the business, and defaulting it to where we are sitting would be the
      // platform deciding one.
      timezone: String(formData.get('timezone') ?? ''),
      currency: String(formData.get('currency') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, provisioned: null };
    }
    throw error;
  }

  revalidatePlatform();
  return { error: null, provisioned: name.trim() };
}
