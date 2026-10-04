import { FormDefinitionSchema, formIsPublishable, type FormDefinition } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * A business's forms: creating, editing a draft, publishing, archiving and reading what was
 * submitted. A form is a stable identity, a revision is one immutable definition of it, and a
 * submission names the exact revision it was answered against. Every door is a Postgres function
 * that proves `organization.manage` itself; nothing here decides who may act.
 */

export type FormListEntry = {
  id: string;
  name: string;
  slug: string;
  archived: boolean;
  publishedRevisionNumber: number | null;
  publishedAt: string | null;
  hasDraft: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
  updatedAt: string;
};

export type FormRevision = {
  id: string;
  number: number;
  status: 'draft' | 'published' | 'archived';
  definition: FormDefinition;
  publishedAt: string | null;
};

export type FormHistoryEntry = {
  id: string;
  number: number;
  status: string;
  publishedAt: string | null;
  archivedAt: string | null;
  submissionCount: number;
};

export type FormEditorState = {
  form: { id: string; name: string; slug: string; archived: boolean; createdFromTemplateKey: string | null };
  published: FormRevision | null;
  working: FormRevision | null;
  history: FormHistoryEntry[];
};

export type FormSubmissionEntry = {
  id: string;
  submittedAt: string;
  revisionId: string;
  source: string;
  answers: Record<string, unknown>;
};

export type FormSubmissionsRead = {
  total: number;
  submissions: FormSubmissionEntry[];
  revisions: Array<{ id: string; number: number; definition: FormDefinition }>;
};

export type FormTemplate = {
  key: string;
  name: string;
  description: string;
  category: string;
  definition: FormDefinition;
};

/** The one place a form's address is spelled, so a link shown in Studio is the link the public route serves. */
export function publicFormPath(organizationSlug: string, formSlug: string): string {
  return `/forms/${organizationSlug}/${formSlug}`;
}

function fail(error: { code?: string; message: string }, fallback: string): never {
  if (error.code === '42501') throw new DomainError('Your role cannot manage forms.', 'forms.forbidden');
  if (error.code === 'GD001' || error.code === '23514' || error.code === '55000') throw new DomainError(error.message, 'forms.refused');
  throw new DomainError(error.message || fallback, 'forms.failed');
}

function parseRevision(raw: unknown): FormRevision | null {
  if (!raw) return null;
  const revision = raw as FormRevision;
  return { ...revision, definition: FormDefinitionSchema.parse(revision.definition) };
}

export async function listForms(db: Db, organizationId: string): Promise<FormListEntry[]> {
  const { data, error } = await db.rpc('list_forms', { p_organization_id: organizationId });
  if (error) fail(error, 'The forms could not be read.');
  return (data ?? []) as unknown as FormListEntry[];
}

export async function formEditorState(db: Db, organizationId: string, formId: string): Promise<FormEditorState | null> {
  const { data, error } = await db.rpc('form_editor_state', { p_organization_id: organizationId, p_form_id: formId });
  if (error) fail(error, 'The form could not be read.');
  if (!data) return null;
  const raw = data as unknown as FormEditorState;
  return { ...raw, published: parseRevision(raw.published), working: parseRevision(raw.working) };
}

export async function listFormTemplates(db: Db): Promise<FormTemplate[]> {
  const { data, error } = await db.rpc('list_form_templates');
  if (error) fail(error, 'The templates could not be read.');
  return ((data ?? []) as unknown as FormTemplate[]).map((template) => ({
    ...template,
    definition: FormDefinitionSchema.parse(template.definition),
  }));
}

/** Blank when no template key is given. The new form is the organization's own from this moment. */
export async function createForm(
  db: Db,
  input: { organizationId: string; name: string; templateKey?: string | null },
): Promise<{ formId: string; revisionId: string }> {
  const { data, error } = await db.rpc('create_form', {
    p_organization_id: input.organizationId,
    p_name: input.name,
    p_template_key: input.templateKey ?? undefined,
  });
  if (error) fail(error, 'The form was not created.');
  return data as unknown as { formId: string; revisionId: string };
}

export async function renameForm(db: Db, input: { organizationId: string; formId: string; name: string }): Promise<void> {
  const { error } = await db.rpc('rename_form', { p_organization_id: input.organizationId, p_form_id: input.formId, p_name: input.name });
  if (error) fail(error, 'The form was not renamed.');
}

export async function createFormDraft(db: Db, organizationId: string, formId: string): Promise<string> {
  const { data, error } = await db.rpc('create_form_draft', { p_organization_id: organizationId, p_form_id: formId });
  if (error || !data) fail(error ?? { message: '' }, 'The draft was not created.');
  return data as string;
}

export async function saveFormDraft(
  db: Db,
  input: { organizationId: string; revisionId: string; definition: unknown },
): Promise<void> {
  const parsed = FormDefinitionSchema.safeParse(input.definition);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? 'The form is not valid.', 'forms.invalid_definition');
  }
  const { error } = await db.rpc('save_form_draft', {
    p_organization_id: input.organizationId,
    p_revision_id: input.revisionId,
    p_definition: parsed.data,
  });
  if (error) fail(error, 'The draft was not saved.');
}

export async function publishFormRevision(db: Db, input: { organizationId: string; revisionId: string; definition?: FormDefinition }): Promise<void> {
  if (input.definition && !formIsPublishable(input.definition)) {
    throw new DomainError('Add at least one question before publishing.', 'forms.nothing_to_publish');
  }
  const { error } = await db.rpc('publish_form_revision', { p_organization_id: input.organizationId, p_revision_id: input.revisionId });
  if (error) {
    if (error.code === '23514') throw new DomainError('Add at least one question before publishing.', 'forms.nothing_to_publish');
    fail(error, 'The form was not published.');
  }
}

export async function setFormArchived(db: Db, input: { organizationId: string; formId: string; archived: boolean }): Promise<void> {
  const { error } = await db.rpc('set_form_archived', { p_organization_id: input.organizationId, p_form_id: input.formId, p_archived: input.archived });
  if (error) fail(error, 'The form was not changed.');
}

export async function listFormSubmissions(db: Db, organizationId: string, formId: string): Promise<FormSubmissionsRead | null> {
  const { data, error } = await db.rpc('list_form_submissions', { p_organization_id: organizationId, p_form_id: formId });
  if (error) fail(error, 'The submissions could not be read.');
  if (!data) return null;
  const raw = data as unknown as FormSubmissionsRead;
  return { ...raw, revisions: raw.revisions.map((revision) => ({ ...revision, definition: FormDefinitionSchema.parse(revision.definition) })) };
}
