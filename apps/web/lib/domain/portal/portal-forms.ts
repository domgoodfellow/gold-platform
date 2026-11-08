import { FormPublicationSchema, type FormPublication } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { checkAgainst, submissionFailure, type SubmitFormResult } from '@/lib/domain/forms/public-forms';

/**
 * Forms in the customer portal. The portal owns *which* forms its customers are offered
 * (`portal_forms`); the form does not know it is there, and nothing here copies one.
 *
 * Who a response is about is never an argument. `submit_portal_form` takes the business and the
 * customer from the caller's own portal binding — the one the link they opened created — so a
 * customer id typed into a field, or into the request, has nowhere to land.
 */

/** A business chooses which of its forms the portal offers. */
export async function setPortalForm(db: Db, input: { organizationId: string; formId: string; enabled: boolean }): Promise<void> {
  const { error } = await db.rpc('set_portal_form', { p_organization_id: input.organizationId, p_form_id: input.formId, p_enabled: input.enabled });
  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot manage forms.', 'portal.forms_forbidden');
    throw fromDatabaseError(error, 'portal.forms_failed');
  }
}

/** The published forms this portal customer is offered, from their own binding. */
export async function portalFormsAvailable(db: Db): Promise<FormPublication[]> {
  const { data, error } = await db.rpc('portal_forms_available');
  if (error) throw fromDatabaseError(error, 'portal.forms_read_failed');
  return FormPublicationSchema.array().parse(data ?? []);
}

export async function submitPortalForm(
  db: Db,
  input: { formId: string; revisionId?: string; answers: Record<string, unknown> },
): Promise<SubmitFormResult> {
  const offered = (await portalFormsAvailable(db)).find((form) => form.formId === input.formId);
  if (!offered) return { ok: false, message: 'This form is not available.', fieldErrors: {}, stale: false };
  if (input.revisionId !== undefined && input.revisionId !== offered.revisionId) return { ok: false, message: 'This form has changed since it was opened. Reload it before submitting.', fieldErrors: {}, stale: true };

  const checked = checkAgainst(offered.definition, input.answers);
  if (!checked.ok) return checked.result;

  const { error } = await db.rpc('submit_portal_form', {
    p_form_id: offered.formId,
    p_revision_id: offered.revisionId,
    p_answers: checked.answers,
  });
  return error ? submissionFailure(error) : { ok: true };
}
