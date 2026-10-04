import { checkFormAnswers, FormProjectionSchema, type FormProjection } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What a stranger may do with a form: read the one published revision, and submit to it. The
 * business and the form come from the public address, never from an id the visitor supplies, and
 * the revision they were shown must still be the published one.
 */

export async function publishedForm(db: Db, organizationSlug: string, formSlug: string): Promise<FormProjection | null> {
  const { data, error } = await db.rpc('published_form', { p_organization_slug: organizationSlug, p_form_slug: formSlug });
  if (error) throw new DomainError(error.message, 'forms.read_failed');
  if (!data) return null;
  const parsed = FormProjectionSchema.safeParse(data);
  if (!parsed.success) throw new DomainError('The published form does not match its supported schema.', 'forms.invalid_projection');
  return parsed.data;
}

export type SubmitFormResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string>; stale: boolean };

/**
 * Same anonymous axis booking and the marketing intake use (D22): sign in anonymously so the write
 * has a real actor, make the one privileged call, sign out. The browser's checks are only a
 * convenience — the answers are checked again here against the published definition, and again by
 * the database, which is the authority.
 *
 * `revisionId` is the revision the visitor was shown. It is sent back so the database can refuse an
 * answer given to a form that has since changed, instead of judging it against a different one.
 */
export async function submitPublicForm(
  db: Db,
  input: { organizationSlug: string; formSlug: string; revisionId: string; answers: Record<string, unknown> },
): Promise<SubmitFormResult> {
  const form = await publishedForm(db, input.organizationSlug, input.formSlug);
  if (!form) return { ok: false, message: 'This form is not accepting responses.', fieldErrors: {}, stale: false };
  if (form.revisionId !== input.revisionId) {
    return { ok: false, message: 'This form was just updated. Please reload the page and answer it again.', fieldErrors: {}, stale: true };
  }

  const checked = checkFormAnswers(form.definition, input.answers);
  if (!checked.ok) {
    const { _form, ...fieldErrors } = checked.errors;
    return { ok: false, message: _form ?? 'Please check the highlighted answers.', fieldErrors, stale: false };
  }

  // Only a session this call made is this call's to end: somebody already signed in (a business
  // owner trying their own form) keeps theirs.
  const { data: existing } = await db.auth.getUser();
  const madeSession = !existing.user;
  if (madeSession) {
    const { error } = await db.auth.signInAnonymously();
    if (error) return { ok: false, message: 'This form is not available right now. Please try again shortly.', fieldErrors: {}, stale: false };
  }

  const { error } = await db.rpc('submit_public_form', {
    p_organization_slug: input.organizationSlug,
    p_form_slug: input.formSlug,
    p_revision_id: input.revisionId,
    p_answers: checked.answers,
  });
  if (madeSession) await db.auth.signOut();

  if (error) {
    if (error.code === 'GD002') return { ok: false, message: 'This form was just updated. Please reload the page and answer it again.', fieldErrors: {}, stale: true };
    if (error.code === 'GD001') return { ok: false, message: 'This form is not accepting responses.', fieldErrors: {}, stale: false };
    if (error.code === '23514') return { ok: false, message: error.message, fieldErrors: {}, stale: false };
    return { ok: false, message: 'Your response could not be sent. Please try again.', fieldErrors: {}, stale: false };
  }
  return { ok: true };
}
