'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  createResourceAvailabilityException,
  deleteResourceAvailabilityException,
  exceptionInstants,
  listAvailabilityConflicts,
  setResourceWorkingHours,
  inheritOrganizationHours,
  type WorkingPeriod,
} from '@/lib/domain/scheduling/resource-availability';
import { requireOrganization } from '@/lib/route/organization';

/** `warning` is not a refusal: the change was made, and this is the booked work it now touches. */
export type ResourceAvailabilityState = { error: string | null; saved?: boolean; warning?: string | null };

/** How far ahead "booked work this touches" looks. Past work is history, and is never flagged. */
const LOOKAHEAD_DAYS = 400;

/** Scheduled work the resource is on that no longer fits — said once, in words, after the change that caused it. */
async function warningFor(
  db: Awaited<ReturnType<typeof getDb>>,
  organizationId: string,
  resourceId: string,
): Promise<string | null> {
  const from = new Date();
  const to = new Date(from.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  const conflicts = (
    await listAvailabilityConflicts(db, {
      organizationId,
      within: { startsAt: from.toISOString(), endsAt: to.toISOString() },
    })
  ).filter((conflict) => conflict.resourceId === resourceId);
  const jobs = new Set(conflicts.map((conflict) => conflict.workItemId)).size;
  if (jobs === 0) return null;
  return `${jobs} scheduled ${jobs === 1 ? 'job falls' : 'jobs fall'} outside this resource’s availability. Nothing was moved — they are flagged on the schedule.`;
}

function revalidate(organizationId: string, resourceId: string): void {
  revalidatePath(`/organizations/${organizationId}/resources/${resourceId}`);
  revalidatePath(`/organizations/${organizationId}/resources`);
  revalidatePath(`/organizations/${organizationId}/schedule`);
  revalidatePath(`/organizations/${organizationId}/work/dispatch`);
  revalidatePath(`/organizations/${organizationId}/field`);
  revalidatePath(`/organizations/${organizationId}/resources`);
}

export async function saveWorkingHoursAction(
  _previous: ResourceAvailabilityState,
  formData: FormData,
): Promise<ResourceAvailabilityState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  await requireOrganization(organizationId);

  let warning: string | null = null;
  try {
    if (String(formData.get('mode') ?? '') === 'inherit') {
      await inheritOrganizationHours(db, { resourceId });
    } else {
      let periods: WorkingPeriod[];
      try {
        periods = JSON.parse(String(formData.get('periods') ?? '[]')) as WorkingPeriod[];
      } catch {
        throw new DomainError('Those hours could not be read.', 'resource_hours.unreadable');
      }
      await setResourceWorkingHours(db, { resourceId, periods });
    }
    warning = await warningFor(db, organizationId, resourceId);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, resourceId);
  return { error: null, saved: true, warning };
}

export async function addExceptionAction(
  _previous: ResourceAvailabilityState,
  formData: FormData,
): Promise<ResourceAvailabilityState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  const startDate = String(formData.get('startDate') ?? '');
  const endDate = String(formData.get('endDate') ?? '') || startDate;
  const allDay = formData.get('allDay') === 'on';

  let warning: string | null = null;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new DomainError('Give the date this starts.', 'resource_exceptions.date_required');
    }
    const startTime = String(formData.get('startTime') ?? '');
    const endTime = String(formData.get('endTime') ?? '');
    if (!allDay && (!startTime || !endTime)) {
      throw new DomainError('Give a start and an end time, or tick all day.', 'resource_exceptions.time_required');
    }

    // The person typed a date and a time as their own business reads them. They become instants here,
    // in the organization's zone — never the server's.
    const window = exceptionInstants({
      startDate,
      endDate,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      timeZone: organization.timezone,
    });

    await createResourceAvailabilityException(db, {
      resourceId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      reason: String(formData.get('reason') ?? ''),
    });
    warning = await warningFor(db, organizationId, resourceId);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, resourceId);
  return { error: null, saved: true, warning };
}

export async function deleteExceptionAction(
  _previous: ResourceAvailabilityState,
  formData: FormData,
): Promise<ResourceAvailabilityState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const resourceId = String(formData.get('resourceId') ?? '');
  await requireOrganization(organizationId);

  try {
    await deleteResourceAvailabilityException(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, resourceId);
  return { error: null, saved: true };
}
