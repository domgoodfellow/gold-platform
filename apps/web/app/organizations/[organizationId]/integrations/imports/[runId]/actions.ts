'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { applyImportRun, resumeImportStaging } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';

export type ApplyState = { error: string | null };

export async function resumeImportStagingAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const runId = String(formData.get('runId') ?? '');
  const { db } = await requireOrganization(organizationId);
  const path = `/organizations/${organizationId}/integrations/imports/${runId}`;
  try {
    await resumeImportStaging(db, { organizationId, runId });
  } catch (error) {
    if (error instanceof DomainError) redirect(`${path}?stageError=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath(path);
  redirect(path);
}

export async function applyImportRunAction(
  _previous: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const runId = String(formData.get('runId') ?? '');

  try {
    await applyImportRun(db, { organizationId, runId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/integrations/imports/${runId}`);
  revalidatePath(`/organizations/${organizationId}/integrations/imports`);
  revalidatePath(`/organizations/${organizationId}/crm`);
  revalidatePath(`/organizations/${organizationId}/customers`);
  redirect(`/organizations/${organizationId}/integrations/imports/${runId}`);
}
