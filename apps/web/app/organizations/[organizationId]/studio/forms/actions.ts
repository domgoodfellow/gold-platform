'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { FormDefinitionSchema } from '@gold/schemas';
import { getDb } from '@/lib/db/server';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { GOLD_HOMEPAGE_CACHE_TAG } from '@/lib/domain/public-site/cached';
import { setPortalForm } from '@/lib/domain/portal/portal-forms';
import {
  createForm,
  createFormDraft,
  formEditorState,
  formSubmissionCustomerCandidates,
  linkFormSubmissionCustomer,
  publishFormRevision,
  renameForm,
  readFormRevision,
  saveFormDraft,
  setFormArchived,
  type FormCustomerCandidate,
  type FormRevision,
} from '@/lib/domain/forms/forms';

export type FormActionResult = { error: string | null };

export async function inspectFormRevisionAction(input: { organizationId: string; formId: string; revisionId: string }): Promise<{ error: string | null; revision: FormRevision | null }> {
  const { db } = await requireOrganization(input.organizationId);
  try {
    const revision = await readFormRevision(db, input.organizationId, input.formId, input.revisionId);
    return { error: revision ? null : 'This form revision was not found.', revision };
  } catch (error) {
    return { ...failure(error), revision: null };
  }
}

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
    // A website that carries this form was cached with the revision it had; the form's own publish
    // is what changes what that page shows, so it expires the page - and only when one carries it.
    if ((await formEditorState(db, input.organizationId, input.formId))?.placements.websitePublished) updateTag(GOLD_HOMEPAGE_CACHE_TAG);
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

/** The portal offers this form to its customers, or stops. The portal owns the list; the form is only named in it. */
export async function setPortalFormAction(input: { organizationId: string; formId: string; enabled: boolean }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await setPortalForm(await getDb(), input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}`);
  revalidatePath(studioFormsPath(input.organizationId));
  return { error: null };
}

export async function customerCandidatesAction(input: { organizationId: string; submissionId: string }): Promise<{ error: string | null; candidates: FormCustomerCandidate[] }> {
  await requireOrganization(input.organizationId);
  try {
    return { error: null, candidates: await formSubmissionCustomerCandidates(await getDb(), input.organizationId, input.submissionId) };
  } catch (error) {
    return { ...failure(error), candidates: [] };
  }
}

export async function linkSubmissionCustomerAction(input: { organizationId: string; formId: string; submissionId: string; customerId: string | null }): Promise<FormActionResult> {
  await requireOrganization(input.organizationId);
  try {
    await linkFormSubmissionCustomer(await getDb(), input);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`${studioFormsPath(input.organizationId)}/${input.formId}/submissions`);
  return { error: null };
}
