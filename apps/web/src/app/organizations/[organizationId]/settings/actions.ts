'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  addOperatingHours,
  removeOperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';

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
