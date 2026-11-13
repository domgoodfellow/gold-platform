'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { applyImportRun, decideImportRow, resumeImportStaging, skipUndecidedImportRows, type ImportRowDecision } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { libraryHref, libraryImportHref } from '@/lib/route/library';

export type ApplyState = { error: string | null };

export async function resumeImportStagingAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const runId = String(formData.get('runId') ?? '');
  const { db } = await requireOrganization(organizationId);
  const path = libraryImportHref(organizationId, runId);
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

  revalidatePath(libraryImportHref(organizationId, runId));
  revalidatePath(libraryHref(organizationId, 'sources'));
  revalidatePath(`/organizations/${organizationId}/crm`);
  revalidatePath(`/organizations/${organizationId}/crm/contacts`);
  redirect(libraryImportHref(organizationId, runId));
}

/** One row's decision before applying: create, update one of its matching contacts, or skip. */
export async function decideImportRowAction(
  organizationId: string,
  runId: string,
  rowId: string,
  decision: ImportRowDecision,
  customerId?: string | null,
): Promise<{ error: string | null }> {
  const { db } = await requireOrganization(organizationId);
  try {
    await decideImportRow(db, { organizationId, runId, rowId, decision, customerId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(libraryImportHref(organizationId, runId));
  return { error: null };
}

/** Skips every row still marked Needs review. */
export async function skipUndecidedImportRowsAction(_previous: ApplyState, formData: FormData): Promise<ApplyState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const runId = String(formData.get('runId') ?? '');
  const { db } = await requireOrganization(organizationId);
  try {
    await skipUndecidedImportRows(db, { organizationId, runId });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(libraryImportHref(organizationId, runId));
  return { error: null };
}
