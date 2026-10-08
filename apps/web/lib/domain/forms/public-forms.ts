import { checkFormAnswers, FormProjectionSchema, type FormProjection } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { openPublicSession } from '@/lib/domain/identity/anonymous-session';

/**
 * What a stranger may do with a form: read the one published revision, and submit to it. Every way
 * in — the hosted page, a website, an embed, a business's own hostname — ends at the same two
 * calls, and none of them takes an organization id: the form is named by its public key (or by the
 * address, which resolves to one), and the revision the visitor was shown must still be the
 * published one.
 */

function parse(data: unknown): FormProjection | null {
  if (!data) return null;
  const parsed = FormProjectionSchema.safeParse(data);
  if (!parsed.success) throw new DomainError('The published form does not match its supported schema.', 'forms.invalid_projection');
  return parsed.data;
}

export async function publishedForm(db: Db, organizationSlug: string, formSlug: string): Promise<FormProjection | null> {
  const { data, error } = await db.rpc('published_form', { p_organization_slug: organizationSlug, p_form_slug: formSlug });
  if (error) throw new DomainError(error.message, 'forms.read_failed');
  return parse(data);
}

export async function publishedFormByKey(db: Db, publicKey: string): Promise<FormProjection | null> {
  const { data, error } = await db.rpc('published_form_by_key', { p_key: publicKey });
  if (error) throw new DomainError(error.message, 'forms.read_failed');
  return parse(data);
}

/** A form at a business's own hostname. The business is whatever the hostname resolver says it is. */
export async function publishedHostnameForm(db: Db, hostname: string, formSlug: string): Promise<FormProjection | null> {
  const { data, error } = await db.rpc('published_hostname_form', { p_hostname: hostname, p_form_slug: formSlug });
  if (error) throw new DomainError(error.message, 'forms.read_failed');
  return parse(data);
}

/** The three public surfaces. `portal` and `booking` are not here: only their own owners may say so. */
export type PublicFormSource = 'hosted' | 'website' | 'embed';

export type SubmitFormResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string>; stale: boolean };

const STALE: SubmitFormResult = { ok: false, message: 'This form was just updated. Please reload the page and answer it again.', fieldErrors: {}, stale: true };
const CLOSED: SubmitFormResult = { ok: false, message: 'This form is not accepting responses.', fieldErrors: {}, stale: false };

/** One sentence per database refusal, shared by every door a response can come through. */
export function submissionFailure(error: { code?: string; message: string }): SubmitFormResult {
  if (error.code === 'GD002') return STALE;
  if (error.code === 'GD001') return CLOSED;
  if (error.code === 'GD003') return { ok: false, message: error.message, fieldErrors: {}, stale: false };
  if (error.code === '23514') return { ok: false, message: error.message, fieldErrors: {}, stale: false };
  return { ok: false, message: 'Your response could not be sent. Please try again.', fieldErrors: {}, stale: false };
}

/** The browser's own checks are a convenience; this is the same check, on the published definition, before the database's. */
export function checkAgainst(form: FormProjection['definition'], answers: Record<string, unknown>) {
  const checked = checkFormAnswers(form, answers);
  if (checked.ok) return { ok: true as const, answers: checked.answers };
  const { _form, ...fieldErrors } = checked.errors;
  return {
    ok: false as const,
    result: { ok: false, message: _form ?? 'Please check the highlighted answers.', fieldErrors, stale: false } satisfies SubmitFormResult,
  };
}

/**
 * Submit to the published form named by `publicKey`. A visitor holds a temporary anonymous session
 * for exactly the length of the write; somebody already signed in writes as themselves and keeps
 * their session (`openPublicSession`).
 *
 * `revisionId` is the revision the visitor was shown. It is sent back so the database can refuse an
 * answer given to a form that has since changed, instead of judging it against a different one.
 */
export async function submitPublicFormByKey(
  db: Db,
  input: { publicKey: string; revisionId: string; answers: Record<string, unknown>; source: PublicFormSource; attribution?: { token?: string; utm: Record<string, string>; requestId: string } },
): Promise<SubmitFormResult> {
  const form = await publishedFormByKey(db, input.publicKey);
  if (!form) return CLOSED;
  if (form.revisionId !== input.revisionId) return STALE;

  const checked = checkAgainst(form.definition, input.answers);
  if (!checked.ok) return checked.result;

  const session = await openPublicSession(db);
  if (!session.ok) return { ok: false, message: 'This form is not available right now. Please try again shortly.', fieldErrors: {}, stale: false };
  try {
    const { error } = input.attribution ? await db.rpc('submit_marketing_form', {
      p_public_key: input.publicKey,
      p_revision_id: input.revisionId,
      p_answers: checked.answers,
      p_source: input.source,
      p_token: (input.attribution.token ?? null) as unknown as string,
      p_utm: input.attribution.utm,
      p_request_id: input.attribution.requestId,
    }) : await db.rpc('submit_public_form_by_key', {
      p_public_key: input.publicKey,
      p_revision_id: input.revisionId,
      p_answers: checked.answers,
      p_source: input.source,
    });
    return error ? submissionFailure(error) : { ok: true };
  } finally {
    await session.end();
  }
}

/** The hosted address names the form by slug; it resolves to the key and the one door above. */
export async function submitPublicForm(
  db: Db,
  input: { organizationSlug: string; formSlug: string; revisionId: string; answers: Record<string, unknown> },
): Promise<SubmitFormResult> {
  const form = await publishedForm(db, input.organizationSlug, input.formSlug);
  if (!form) return CLOSED;
  return submitPublicFormByKey(db, { publicKey: form.publicKey, revisionId: input.revisionId, answers: input.answers, source: 'hosted' });
}
