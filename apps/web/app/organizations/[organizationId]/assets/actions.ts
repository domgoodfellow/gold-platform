'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { createAsset } from '@/lib/domain/assets/assets';
import { DomainError } from '@/lib/domain/errors';

export type CreateAssetState = { error: string | null };

export async function createAssetAction(
  _previous: CreateAssetState,
  formData: FormData,
): Promise<CreateAssetState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // Neither id is re-validated here: both references are composite, so one naming another
    // tenant's row is refused by the database rather than leaking.
    await createAsset(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      customerId: String(formData.get('customerId') ?? ''),
      locationId: String(formData.get('locationId') ?? ''),
      custom: customValuesFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/assets`);
  return { error: null };
}
