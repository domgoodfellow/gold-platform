'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addOperatingHours, removeOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireOrganization } from '@/lib/route/organization';

export type ScheduleConfigActionState = { error: string | null };

export async function addOperatingHoursAction(
  _previous: ScheduleConfigActionState,
  formData: FormData,
): Promise<ScheduleConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidatePath(`/organizations/${organizationId}/schedule/configuration`);
  revalidatePath(`/organizations/${organizationId}/schedule`);
  return { error: null };
}

export async function removeOperatingHoursAction(
  _previous: ScheduleConfigActionState,
  formData: FormData,
): Promise<ScheduleConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await removeOperatingHours(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/schedule/configuration`);
  revalidatePath(`/organizations/${organizationId}/schedule`);
  return { error: null };
}
