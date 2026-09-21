'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  addTypeChecklistItem,
  removeTypeChecklistItem,
} from '@/lib/domain/work-items/checklists';
import {
  createWorkItemStatus,
  updateWorkItemStatus,
} from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import {
  createWorkItemType,
  renameWorkItemType,
  setTypeBookable,
} from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';

export type WorkConfigActionState = { error: string | null };

/**
 * Both surfaces read what these writes change — the operational board groups jobs by these same
 * statuses and types, this screen defines them — so a change here invalidates both rather than
 * leaving the board showing a status that was just renamed.
 */
function revalidateWork(organizationId: string): void {
  revalidatePath(`/organizations/${organizationId}/work/configuration`);
  revalidatePath(`/organizations/${organizationId}/work`);
}

export async function createStatusAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidateWork(organizationId);
  return { error: null };
}

export async function createTypeAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidateWork(organizationId);
  return { error: null };
}

export async function createTransitionAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidateWork(organizationId);
  return { error: null };
}

export async function renameTypeAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidateWork(organizationId);
  return { error: null };
}

/**
 * Publish a kind of work to the public booking page, or withdraw it.
 *
 * Withdrawing is the same call with nothing selected, because there is no `bookable` flag to
 * clear — a type is published when it says which status a booking arrives in and how long one
 * takes, and passing null for the status is how it stops saying so.
 */
export async function setTypeBookableAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const statusId = String(formData.get('statusId') ?? '');
  const duration = String(formData.get('durationMinutes') ?? '');
  const priceItemId = String(formData.get('priceItemId') ?? '');

  try {
    const publishing = formData.get('withdraw') === null && statusId !== '';

    await setTypeBookable(db, {
      id: String(formData.get('typeId') ?? ''),
      statusId: publishing ? statusId : null,
      // Left as typed rather than coerced to a default: `setTypeBookable` refuses a duration
      // that is not a whole number of minutes, and a caller inventing one here would be the
      // route deciding something the domain layer owns.
      durationMinutes: publishing ? Number(duration) : null,
      priceItemId: publishing && priceItemId !== '' ? priceItemId : null,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The public booking page itself reads the published state directly (not cached here), but
  // the operational Work screen's per-type "publish" affordance and this one both need to agree.
  revalidateWork(organizationId);
  return { error: null };
}

export async function updateStatusAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await updateWorkItemStatus(db, {
      id: String(formData.get('statusId') ?? ''),
      name: String(formData.get('name') ?? ''),
      position: Number(formData.get('position') ?? Number.NaN),
      // An unchecked checkbox submits nothing at all, which is the false this needs.
      releasesResource: formData.get('releasesResource') === '1',
      marksComplete: formData.get('marksComplete') === '1',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateWork(organizationId);
  return { error: null };
}

export async function addTypeChecklistItemAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

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

  revalidateWork(organizationId);
  return { error: null };
}

export async function removeTypeChecklistItemAction(
  _previous: WorkConfigActionState,
  formData: FormData,
): Promise<WorkConfigActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    // Work items already created keep their copies — that is the design, not a caveat.
    await removeTypeChecklistItem(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidateWork(organizationId);
  return { error: null };
}
