'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';

export type LocationActionState = { error: string | null };

export async function createLocationAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createLocation(db, {
      organizationId,
      label: String(formData.get('label') ?? ''),
      address: String(formData.get('address') ?? ''),
      accessNotes: String(formData.get('accessNotes') ?? ''),
      custom: customValuesFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/locations`);
  return { error: null };
}

export async function linkCustomerAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // None of these three ids is re-validated here. The composite foreign keys make a row
    // naming two different tenants impossible to write, so a tampered customer id produces a
    // refusal rather than a leak — the same argument as the hidden organization id.
    await linkCustomerLocation(db, {
      organizationId,
      customerId: String(formData.get('customerId') ?? ''),
      locationId: String(formData.get('locationId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/locations`);
  return { error: null };
}
