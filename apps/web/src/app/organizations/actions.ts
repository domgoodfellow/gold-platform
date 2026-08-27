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
