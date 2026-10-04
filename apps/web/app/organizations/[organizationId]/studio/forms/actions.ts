'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { FormDefinitionSchema } from '@gold/schemas';
import { getDb } from '@/lib/db/server';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import {
  createForm,
  createFormDraft,
  publishFormRevision,
  renameForm,
  saveFormDraft,
  setFormArchived,
} from '@/lib/domain/forms/forms';

export type FormActionResult = { error: string | null };

function failure(error: unknown): FormActionResult {
  if (error instanceof DomainError) return { error: error.message };
  return { error: error instanceof Error ? error.message : 'The form could not be changed.' };
}

function studioFormsPath(organizationId: string) {
  return `/organizations/${organizationId}/studio/forms`;
}

/** Blank without a template key; from a starter with one. Either way the new form is the business's own. */
export async function createFormAction(input: { organizationId: string; name: string; templateKey?: string }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  let formId: string;
  try {
    ({ formId } = await createForm(await getDb(), input));
  } catch (error) {
    return failure(error);
  }
  revalidatePath(studioFormsPath(input.organizationId));
  redirect(`${studioFormsPath(input.organizationId)}/${formId}`);
}

export async function saveFormDraftAction(input: { organizationId: string; formId: string; revisionId: string; definition: unknown }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await saveFormDraft(await getDb(), input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  return { error: null };
}

export async function createFormDraftAction(input: { organizationId: string; formId: string }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await createFormDraft(await getDb(), input.organizationId, input.formId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  return { error: null };
}

/**
 * Publishing saves what is on the screen first, so a visitor is never shown something different
 * from what the author last looked at. The draft is only ever replaced by the publish itself.
 */
export async function publishFormAction(input: { organizationId: string; formId: string; revisionId: string; definition: unknown }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    const definition = FormDefinitionSchema.parse(input.definition);
    const db = await getDb();
    await saveFormDraft(db, { organizationId: input.organizationId, revisionId: input.revisionId, definition });
    await publishFormRevision(db, { organizationId: input.organizationId, revisionId: input.revisionId, definition });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(studioFormsPath(input.organizationId));
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  return { error: null };
}

export async function renameFormAction(input: { organizationId: string; formId: string; name: string }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await renameForm(await getDb(), input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(studioFormsPath(input.organizationId));
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  return { error: null };
}

export async function setFormArchivedAction(input: { organizationId: string; formId: string; archived: boolean }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await setFormArchived(await getDb(), input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(studioFormsPath(input.organizationId));
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  return { error: null };
}
