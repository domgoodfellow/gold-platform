'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { linkCustomerLocation, locateAddress, setLocationCoordinates } from '@/lib/domain/locations/locations';
import { uploadDocument } from '@/lib/domain/documents/documents';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import type { CoordinatesActionState, LocationActionState } from '../actions';

function revalidate(organizationId: string, locationId: string) {
  revalidatePath(`/organizations/${organizationId}/locations/${locationId}`);
}

export async function locationCoordinatesAction(
  _previous: CoordinatesActionState,
  formData: FormData,
): Promise<CoordinatesActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');

  if (String(formData.get('intent') ?? '') === 'look-up') {
    try {
      const found = await locateAddress({ address: String(formData.get('address') ?? '') });
      return { error: null, suggested: found, notFound: found === null };
    } catch (error) {
      if (error instanceof DomainError) {
        return { error: error.message, suggested: null, notFound: false };
      }
      throw error;
    }
  }

  const latitude = String(formData.get('latitude') ?? '').trim();
  const longitude = String(formData.get('longitude') ?? '').trim();

  try {
    await setLocationCoordinates(await getDb(), {
      id: locationId,
      latitude: latitude === '' ? null : Number(latitude),
      longitude: longitude === '' ? null : Number(longitude),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, suggested: null, notFound: false };
    }
    throw error;
  }

  revalidate(organizationId, locationId);
  return { error: null, suggested: null, notFound: false };
}

export async function linkCustomerAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');

  try {
    // Not re-validated here: the composite foreign keys on `customer_locations` make a row
    // naming two different tenants impossible to write, so a tampered id is refused rather
    // than leaked — the same argument the list page's own action rests on.
    await linkCustomerLocation(db, {
      organizationId,
      customerId: String(formData.get('customerId') ?? ''),
      locationId,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidate(organizationId, locationId);
  return { error: null };
}

export async function uploadLocationDocumentAction(
  _previous: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return { error: 'Choose a file first.' };
  }

  try {
    await uploadDocument(db, {
      organizationId,
      attachedTo: { entity: 'location', id: locationId },
      file,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, locationId);
  return { error: null };
}
