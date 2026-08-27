'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { customValuesFromFormData } from '@/lib/custom-fields';
import { DomainError } from '@/lib/domain/errors';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

export type WorkActionState = { error: string | null };

export async function createWorkItemAction(
  _previous: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');

  try {
    // None of these ids is re-validated here. All four references are composite, so one
    // naming another tenant's row is refused by the database rather than leaking.
    await createWorkItem(db, {
      organizationId,
      title: String(formData.get('title') ?? ''),
      statusId: String(formData.get('statusId') ?? ''),
      customerId: String(formData.get('customerId') ?? ''),
      locationId: String(formData.get('locationId') ?? ''),
      resourceId: String(formData.get('resourceId') ?? ''),
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
    // No position submitted: the domain puts a new status at the end of the board, which is
    // where a newly invented stage nearly always belongs.
    await createWorkItemStatus(db, {
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
