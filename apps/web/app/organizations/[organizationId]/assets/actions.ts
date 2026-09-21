'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { createAsset } from '@/lib/domain/assets/assets';
import { recordAssetReading } from '@/lib/domain/assets/readings';
import { DomainError } from '@/lib/domain/errors';
import { requireOrganization } from '@/lib/route/organization';

export type CreateAssetState = { error: string | null; created: boolean };
export type RecordReadingState = { error: string | null };

export async function createAssetAction(
  _previous: CreateAssetState,
  formData: FormData,
): Promise<CreateAssetState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/assets`);
  return { error: null, created: true };
}

/**
 * Write down what a machine's counter says.
 *
 * **The rules run inside this write**, in a trigger on the table, so a business whose
 * maintenance rule is wrong still records its reading and reads the failure on the Automations
 * screen. What a person did stands; what a rule made of it is recorded separately.
 */
export async function recordReadingAction(
  _previous: RecordReadingState,
  formData: FormData,
): Promise<RecordReadingState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await recordAssetReading(db, {
      organizationId,
      assetId: String(formData.get('assetId') ?? ''),
      value: Number(formData.get('value') ?? Number.NaN),
      unit: String(formData.get('unit') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/assets`);
  return { error: null };
}
