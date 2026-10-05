'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import {
  scheduleWorkItem,
  setWorkItemResources,
  unscheduleWorkItem,
} from '@/lib/domain/scheduling/schedule';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { DomainError } from '@/lib/domain/errors';
import { changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export type WorkActionState = { error: string | null };

export async function createWorkItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    // None of these ids is re-validated here. Every reference is composite, so one naming
    // another tenant's row is refused by the database rather than leaking. The type is not
    // submitted at all — it follows from the status.
    await createWorkItem(db, {
      organizationId,
      title: String(formData.get('title') ?? ''),
      statusId: String(formData.get('statusId') ?? ''),
      customerId: String(formData.get('customerId') ?? ''),
      locationId: String(formData.get('locationId') ?? ''),
      resourceIds: formData.getAll('resourceIds').map(String).filter(Boolean),
      assetId: String(formData.get('assetId') ?? ''),
      custom: customValuesFromFormData(formData),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}

export async function changeStatusAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    // Whether this move is legal is not decided here, and is not decided in the domain layer
    // either. `app.check_status_transition` decides it, so a caller who forges a status id
    // into this form is refused by the same rule that governs the button.
    await changeWorkItemStatus(db, {
      workItemId: String(formData.get('workItemId') ?? ''),
      toStatusId: String(formData.get('toStatusId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  revalidatePath(
    `/organizations/${organizationId}/work/${String(formData.get('workItemId') ?? '')}`,
  );
  return { error: null };
}

/**
 * Kept genuinely one action for scheduling and clearing: `formData.get('clear')` is the only
 * branch, and both outcomes touch the same three surfaces below — Work (the record and its own
 * detail page), Schedule (the resource that gained or lost a window) and Field (its "Scheduled
 * today" count).
 */
export async function scheduleWorkItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    // The overlap is not checked here and must not be. `work_item_resource_assignments_resource_not_double_booked`
    // is the guarantee, and it is the only thing that can catch two dispatchers committing
    // the same free slot at the same moment (I6, I7).
    if (formData.get('clear')) {
      await unscheduleWorkItem(db, { workItemId: String(formData.get('workItemId') ?? '') });
    } else {
      await scheduleWorkItem(db, {
        workItemId: String(formData.get('workItemId') ?? ''),
        // Every ticked box, or none: the form always shows who is on the job, so this is the set.
        resourceIds: formData.getAll('resourceIds').map(String).filter(Boolean),
        // Typed as the business reads the clock, so it is converted in the business's zone — never the server's.
        startsAt: localDateTimeToInstant(String(formData.get('startsAt') ?? ''), organization.timezone),
        endsAt: localDateTimeToInstant(String(formData.get('endsAt') ?? ''), organization.timezone),
      });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  revalidatePath(
    `/organizations/${organizationId}/work/${String(formData.get('workItemId') ?? '')}`,
  );
  revalidatePath(`/organizations/${organizationId}/schedule`);
  revalidatePath(`/organizations/${organizationId}/field`);
  return { error: null };
}

/**
 * Change who is on a work item and nothing else. The database takes the whole set or none of it, so
 * a busy resource leaves the job exactly as it was.
 */
export async function setWorkItemResourcesAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await setWorkItemResources(db, {
      workItemId: String(formData.get('workItemId') ?? ''),
      resourceIds: formData.getAll('resourceIds').map(String).filter(Boolean),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  revalidatePath(
    `/organizations/${organizationId}/work/${String(formData.get('workItemId') ?? '')}`,
  );
  revalidatePath(`/organizations/${organizationId}/schedule`);
  revalidatePath(`/organizations/${organizationId}/resources`);
  revalidatePath(`/organizations/${organizationId}/field`);
  return { error: null };
}
