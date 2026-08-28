'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import {
  scheduleWorkItem,
  unscheduleWorkItem,
} from '@/lib/domain/scheduling/schedule';
import { DomainError } from '@/lib/domain/errors';
import {
  addTypeChecklistItem,
  removeTypeChecklistItem,
} from '@/lib/domain/work-items/checklists';
import {
  createWorkItemStatus,
  updateWorkItemStatus,
} from '@/lib/domain/work-items/statuses';
import {
  changeWorkItemStatus,
  createWorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemType, renameWorkItemType } from '@/lib/domain/work-items/types';
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

export async function createStatusAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // No position submitted: the domain puts a new status at the end of that type's board,
    // which is where a newly invented stage nearly always belongs.
    await createWorkItemStatus(db, {
      organizationId,
      typeId: String(formData.get('typeId') ?? ''),
      name: String(formData.get('name') ?? ''),
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

export async function createTypeAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createWorkItemType(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
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

export async function createTransitionAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await createWorkItemTransition(db, {
      organizationId,
      typeId: String(formData.get('typeId') ?? ''),
      fromStatusId: String(formData.get('fromStatusId') ?? ''),
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

export async function renameTypeAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // Nothing moves. Every status, transition and work item references the type by id, which
    // is what D6 buys by making the tenant's word data rather than an enum.
    await renameWorkItemType(db, {
      id: String(formData.get('typeId') ?? ''),
      name: String(formData.get('name') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}

export async function updateStatusAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await updateWorkItemStatus(db, {
      id: String(formData.get('statusId') ?? ''),
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? Number.NaN),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}

export async function addTypeChecklistItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    await addTypeChecklistItem(db, {
      organizationId,
      typeId: String(formData.get('typeId') ?? ''),
      label: String(formData.get('label') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}

export async function removeTypeChecklistItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // Work items already created keep their copies — that is the design, not a caveat.
    await removeTypeChecklistItem(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/work`);
  return { error: null };
}
