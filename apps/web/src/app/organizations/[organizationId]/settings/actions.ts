'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  addOperatingHours,
  removeOperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { setPublicProfile } from '@/lib/domain/tenancy/profile';

export type SettingsActionState = { error: string | null };

export async function updateOrganizationAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await updateOrganization(db, {
      id: organizationId,
      name: String(formData.get('name') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      currency: String(formData.get('currency') ?? ''),
      bufferMinutes: Number(formData.get('bufferMinutes') ?? Number.NaN),
      slug: String(formData.get('slug') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

export async function addOperatingHoursAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // The day arrives as a number. Nothing in the platform holds a word for a day, in any
    // language — rendering one is this screen's problem and the reader's locale's business.
    await addOperatingHours(db, {
      organizationId,
      dayOfWeek: Number(formData.get('dayOfWeek') ?? Number.NaN),
      opensAt: String(formData.get('opensAt') ?? ''),
      closesAt: String(formData.get('closesAt') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

export async function removeOperatingHoursAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await removeOperatingHours(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}

/**
 * What this business says about itself on its public page.
 *
 * Separate from the settings action above because they are separate claims: the clock a
 * business thinks in is a fact the platform needs to operate it, and a tagline is something it
 * tells strangers. Saving one should not require re-submitting the other.
 */
export async function updateProfileAction(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await setPublicProfile(db, {
      organizationId,
      displayName: String(formData.get('displayName') ?? ''),
      tagline: String(formData.get('tagline') ?? ''),
      intro: String(formData.get('intro') ?? ''),
      contactEmail: String(formData.get('contactEmail') ?? ''),
      contactPhone: String(formData.get('contactPhone') ?? ''),
      address: String(formData.get('address') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  return { error: null };
}
