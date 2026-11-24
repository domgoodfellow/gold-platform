import {
  PageTemplatesSchema, PublicSiteProjectionSchema, PublicWebsiteSnapshotSchema, RevisionContextSchema, SectionPatternsSchema,
  SiteTemplatesSchema, WebsiteContentSchema, WebsiteEditorStateSchema,
  type NavigationItem, type PageTemplate, type PublicSiteProjection, type PublicWebsiteSnapshot, type RevisionContext,
  type SectionPattern, type SiteExperience, type SiteTemplate, type WebsiteContent, type WebsitePage,
} from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
export type { PublicSiteProjection, PublicWebsiteSnapshot, RevisionContext, SiteExperience } from '@gold/schemas';

/**
 * The one public-site engine. A website is one revision of many pages: every read and write here
 * is of a whole snapshot (pages, sections and navigation together), and publishing selects one,
 * so a visitor can never be shown parts of two revisions. The database is the authority; these
 * functions give it a typed face (the typed-RPC rule, `docs/data.md`).
 */

export type RevisionStatus = 'draft' | 'in_review' | 'published' | 'archived' | 'discarded';

/**
 * Three different things a website screen can be asked about, never one number:
 * - the **content revision** (this file: an immutable snapshot of pages and navigation);
 * - the **source revision** (the Git commit whose renderer draws it, `lib/source-revision.ts`);
 * - the **deployment** serving a hostname (provider state, outside the application).
 */
export type EditorRevision = {
  id: string;
  number: number;
  status: RevisionStatus;
  pages: WebsitePage[];
  navigation: NavigationItem[];
  createdAt: string;
  /** `migration` when a GildOps release wrote the revision; `account` when someone did in Studio. */
  createdSource: 'migration' | 'account';
  updatedAt?: string | null;
  submittedAt?: string | null;
  publishedAt?: string | null;
  baseRevisionId: string | null;
  baseRevisionNumber: number | null;
  copiedFromRevisionId: string | null;
  copiedFromRevisionNumber: number | null;
  /** Started before the currently published revision: publishing it would replace newer content. */
  stale: boolean;
};

export type RevisionHistoryEntry = {
  id: string; number: number; status: RevisionStatus; createdAt: string; createdSource: 'migration' | 'account';
  publishedAt: string | null; archivedAt: string | null; discardedAt: string | null; copiedFromRevisionNumber: number | null;
};

export type WebsiteEditorState = {
  siteId: string;
  experience: SiteExperience;
  published: EditorRevision | null;
  working: EditorRevision | null;
  history: RevisionHistoryEntry[];
};

function forbiddenOr(error: { code?: string; message: string }, code: string): DomainError {
  return fromDatabaseError(error, error.code === '42501' ? 'public_site.forbidden' : code);
}

function projection(value: unknown): PublicSiteProjection {
  const parsed = PublicSiteProjectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError('This website can’t be shown right now.', 'public_site.invalid_projection');
  }
  return parsed.data;
}

export function snapshot(value: unknown): PublicWebsiteSnapshot {
  const parsed = PublicWebsiteSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError('This website can’t be shown right now.', 'public_site.invalid_projection');
  }
  return parsed.data;
}

export async function publishedGoldHomepage(db: Db): Promise<PublicSiteProjection> {
  const { data, error } = await db.rpc('published_gold_homepage');
  if (error) throw fromDatabaseError(error, 'public_site.read_failed');
  if (!data) throw new DomainError('No GildOps homepage has been published.', 'public_site.not_published');
  return projection(data);
}

export async function sitePreview(db: Db, input: { organizationId: string; revisionId: string }): Promise<PublicWebsiteSnapshot> {
  const { data, error } = await db.rpc('public_site_preview', { p_organization_id: input.organizationId, p_revision_id: input.revisionId });
  if (error) throw forbiddenOr(error, 'public_site.preview_failed');
  if (!data) throw new DomainError('That website revision does not exist.', 'public_site.revision_missing');
  return snapshot(data);
}

/** Null when this organization has no website yet — the caller then offers to create one. */
export async function siteEditorState(db: Db, organizationId: string): Promise<WebsiteEditorState | null> {
  const { data, error } = await db.rpc('public_site_editor_state', { p_organization_id: organizationId });
  if (error) throw forbiddenOr(error, 'public_site.read_failed');
  if (!data) return null;
  return WebsiteEditorStateSchema.parse(data);
}

export async function createWebsite(db: Db, input: { organizationId: string; templateKey?: string | null }): Promise<string> {
  const { data, error } = await db.rpc('create_public_site', { p_organization_id: input.organizationId, p_template_key: input.templateKey ?? undefined });
  if (error || !data) throw forbiddenOr(error ?? { message: 'The website was not created.' }, 'public_site.create_failed');
  return data;
}

/** A working draft from the published website, or — to restore — from any earlier revision. */
export async function createSiteDraft(db: Db, input: { organizationId: string; fromRevisionId?: string | null }): Promise<string> {
  const { data, error } = await db.rpc('create_public_site_draft', { p_organization_id: input.organizationId, p_from_revision_id: input.fromRevisionId ?? undefined });
  if (error || !data) throw forbiddenOr(error ?? { message: 'The draft was not created.' }, 'public_site.create_failed');
  return data;
}

export async function updateSiteDraft(db: Db, input: { organizationId: string; revisionId: string; content: WebsiteContent }): Promise<void> {
  const content = WebsiteContentSchema.parse(input.content);
  const { error } = await db.rpc('update_public_site_draft', {
    p_organization_id: input.organizationId, p_revision_id: input.revisionId,
    p_pages: content.pages, p_navigation: content.navigation,
  });
  if (error) throw forbiddenOr(error, 'public_site.update_failed');
}

export async function submitSiteRevision(db: Db, organizationId: string, revisionId: string): Promise<void> {
  const { error } = await db.rpc('submit_public_site_revision', { p_organization_id: organizationId, p_revision_id: revisionId });
  if (error) throw forbiddenOr(error, 'public_site.transition_failed');
}

/**
 * Publishing a revision started before the current published one is refused (`public_site.stale`)
 * unless `replaceNewer` says the person chose to replace that newer content.
 */
export async function publishSiteRevision(db: Db, organizationId: string, revisionId: string, options: { replaceNewer?: boolean } = {}): Promise<void> {
  const { error } = await db.rpc('publish_public_site_revision', {
    p_organization_id: organizationId, p_revision_id: revisionId, p_replace_newer: options.replaceNewer ?? false,
  });
  if (error) throw forbiddenOr(error, error.code === 'GD002' ? 'public_site.stale' : 'public_site.transition_failed');
}

/** Ends the working draft (or a revision in review) unpublished. It stays in history, read-only. */
export async function discardSiteDraft(db: Db, organizationId: string, revisionId: string): Promise<void> {
  const { error } = await db.rpc('discard_public_site_draft', { p_organization_id: organizationId, p_revision_id: revisionId });
  if (error) throw forbiddenOr(error, 'public_site.transition_failed');
}

/** Where one revision stands against the published one, and which experience draws it. */
export async function siteRevisionContext(db: Db, input: { organizationId: string; revisionId: string }): Promise<RevisionContext> {
  const { data, error } = await db.rpc('public_site_revision_context', { p_organization_id: input.organizationId, p_revision_id: input.revisionId });
  if (error) throw forbiddenOr(error, 'public_site.preview_failed');
  if (!data) throw new DomainError('That website revision does not exist.', 'public_site.revision_missing');
  return RevisionContextSchema.parse(data);
}

export async function listSiteTemplates(db: Db): Promise<SiteTemplate[]> {
  const { data, error } = await db.rpc('list_site_templates');
  if (error) throw fromDatabaseError(error, 'public_site.templates_failed');
  return SiteTemplatesSchema.parse(data ?? []);
}

export async function listPageTemplates(db: Db): Promise<PageTemplate[]> {
  const { data, error } = await db.rpc('list_page_templates');
  if (error) throw fromDatabaseError(error, 'public_site.templates_failed');
  return PageTemplatesSchema.parse(data ?? []);
}

export async function listSectionPatterns(db: Db): Promise<SectionPattern[]> {
  const { data, error } = await db.rpc('list_section_patterns');
  if (error) throw fromDatabaseError(error, 'public_site.templates_failed');
  return SectionPatternsSchema.parse(data ?? []);
}
