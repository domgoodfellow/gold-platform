'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addChecklistItem, setChecklistItemDone } from '@/lib/domain/work-items/checklists';
import { recordCost, recordTime } from '@/lib/domain/work-items/consumption';

export type WorkItemActionState = { error: string | null };

function revalidate(organizationId: string, workItemId: string) {
  revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
}

export async function addChecklistItemAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await addChecklistItem(db, {
      workItemId,
      label: String(formData.get('label') ?? ''),
      position: Number(formData.get('position') ?? 0),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function setChecklistItemDoneAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Who ticked it is not submitted. The policy pins `done_by` to `auth.uid()`, so a forged
    // field would be refused by the database rather than trusted here (I11).
    await setChecklistItemDone(db, {
      checklistItemId: String(formData.get('checklistItemId') ?? ''),
      done: formData.get('done') === '1',
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function recordTimeAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    await recordTime(db, {
      workItemId,
      resourceId: String(formData.get('resourceId') ?? ''),
      startedAt: String(formData.get('startedAt') ?? ''),
      endedAt: String(formData.get('endedAt') ?? ''),
      note: String(formData.get('note') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}

export async function recordCostAction(
  _previous: WorkItemActionState,
  formData: FormData,
): Promise<WorkItemActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const workItemId = String(formData.get('workItemId') ?? '');

  try {
    // Minor units all the way to the database. The form asks for them explicitly rather than
    // accepting "12.50" and multiplying, because that multiplication is where a rounding bug
    // gets introduced and then rediscovered in a reconciliation months later.
    await recordCost(db, {
      workItemId,
      description: String(formData.get('description') ?? ''),
      amountMinor: Number(formData.get('amountMinor') ?? Number.NaN),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidate(organizationId, workItemId);
  return { error: null };
}
