'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addOperatingHours, removeOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { requireOrganization } from '@/lib/route/organization';

export type ScheduleConfigActionState = { error: string | null };

export async function updateScheduleBufferAction(
  _previous: ScheduleConfigActionState,
  formData: FormData,
): Promise<ScheduleConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    await updateOrganization(db, {
      id: organizationId,
      name: organization.name,
      timezone: organization.timezone,
      currency: organization.currency,
      bufferMinutes: Number(formData.get('bufferMinutes') ?? Number.NaN),
      slug: organization.slug,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/schedule/configuration`);
  revalidatePath(`/organizations/${organizationId}/schedule`);
  revalidatePath(`/organizations/${organizationId}/work/dispatch`);
  revalidatePath(`/organizations/${organizationId}/field`);
  revalidatePath(`/organizations/${organizationId}/resources`);
  if (organization.slug) revalidatePath(`/book/${organization.slug}`);
  return { error: null };
}

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
  revalidatePath(`/organizations/${organizationId}/work/dispatch`);
  revalidatePath(`/organizations/${organizationId}/field`);
  revalidatePath(`/organizations/${organizationId}/resources`);
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
  revalidatePath(`/organizations/${organizationId}/work/dispatch`);
  revalidatePath(`/organizations/${organizationId}/field`);
  revalidatePath(`/organizations/${organizationId}/resources`);
  return { error: null };
}
