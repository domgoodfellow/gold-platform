'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { applyImportRun } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';

export type ApplyState = { error: string | null };

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
  redirect(`/organizations/${organizationId}/integrations/imports/${runId}`);
}
