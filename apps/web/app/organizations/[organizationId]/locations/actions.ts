'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import {
  createLocation,
  linkCustomerLocation,
  locateAddress,
  setLocationCoordinates,
} from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';

export type LocationActionState = { error: string | null; created: boolean };

export async function createLocationAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/locations`);
  // Field Overview counts Locations.
  revalidatePath(`/organizations/${organizationId}/field`);
  return { error: null, created: true };
}

export async function linkCustomerAction(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const locationId = String(formData.get('locationId') ?? '');

  try {
    // None of these three ids is re-validated here. The composite foreign keys make a row
    // naming two different tenants impossible to write, so a tampered customer id produces a
    // refusal rather than a leak — the same argument as the hidden organization id.
    await linkCustomerLocation(db, {
      organizationId,
      customerId: String(formData.get('customerId') ?? ''),
      locationId,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/locations`);
  // The linked location's own detail shows the same "Customers served" list.
  revalidatePath(`/organizations/${organizationId}/locations/${locationId}`);
  return { error: null, created: true };
}

/**
 * Looking an address up, and writing down where a place is.
 *
 * **One action with two intents rather than two actions**, because the two share a form: a
 * lookup offers numbers into the same fields a person can type into, and separate actions would
 * mean separate `useActionState` calls and no way for one to fill the other's inputs. Choosing
 * which domain function to call from a submitted button is a caller dispatching, which is what a
 * caller is for; neither branch decides anything.
 */
export type CoordinatesActionState = {
  error: string | null;
  /**
   * What a lookup came back with — **offered, never written**.
   *
   * `locateAddress` deliberately does not save, so that a provider's best guess about a
   * customer's site is confirmed by somebody before a technician is sent to it.
   */
  suggested: { latitude: number; longitude: number } | null;
  /** A lookup ran and the provider did not recognise the address. Not an error. */
  notFound: boolean;
};

export async function locationCoordinatesAction(
  _previous: CoordinatesActionState,
  formData: FormData,
): Promise<CoordinatesActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  // An empty pair means this business is no longer saying where the place is, which is a
  // legitimate thing to say and needs no separate button.
  const latitude = String(formData.get('latitude') ?? '').trim();
  const longitude = String(formData.get('longitude') ?? '').trim();
  const locationId = String(formData.get('locationId') ?? '');

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

  revalidatePath(`/organizations/${organizationId}/locations`);
  // The same coordinates also render on the location's own detail page.
  revalidatePath(`/organizations/${organizationId}/locations/${locationId}`);
  return { error: null, suggested: null, notFound: false };
}
