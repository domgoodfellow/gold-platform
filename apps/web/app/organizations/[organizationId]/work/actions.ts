'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import {
  scheduleWorkItem,
  unscheduleWorkItem,
} from '@/lib/domain/scheduling/schedule';
import { DomainError } from '@/lib/domain/errors';
import { changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

export type WorkActionState = { error: string | null };

export async function createWorkItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

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
      resourceId: String(formData.get('resourceId') ?? ''),
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
  return { error: null };
}

export async function scheduleWorkItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // The overlap is not checked here and must not be. `work_items_resource_not_double_booked`
    // is the guarantee, and it is the only thing that can catch two dispatchers committing
    // the same free slot at the same moment (I6, I7).
    if (formData.get('clear')) {
      await unscheduleWorkItem(db, { workItemId: String(formData.get('workItemId') ?? '') });
    } else {
      await scheduleWorkItem(db, {
        workItemId: String(formData.get('workItemId') ?? ''),
        resourceId: String(formData.get('resourceId') ?? ''),
        startsAt: String(formData.get('startsAt') ?? ''),
        endsAt: String(formData.get('endsAt') ?? ''),
      });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}
