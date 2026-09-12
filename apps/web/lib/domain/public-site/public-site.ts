import {
  PublicHomepageRevisionSchema,
  PublicHomepageSectionsSchema,
  PublicSiteProjectionSchema,
  type PublicHomepageSections,
  type PublicHomepageRevisionInput,
  type PublicSiteProjection,
} from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
export type { PublicSiteProjection } from '@gold/schemas';

export type EditorRevision = {
  id: string;
  number: number;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  seoTitle: string;
  seoDescription: string;
  sections: PublicHomepageSections;
  submittedAt?: string | null;
  publishedAt?: string | null;
};

export type PublicHomepageEditorState = {
  siteId: string;
  pageId: string;
  published: EditorRevision | null;
  working: EditorRevision | null;
  history: Array<{ id: string; number: number; status: string; publishedAt: string | null; archivedAt: string | null }>;
};

function projection(value: unknown): PublicSiteProjection {
  const parsed = PublicSiteProjectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError('The published website does not match its supported schema.', 'public_site.invalid_projection');
  }
  return parsed.data;
}

export async function publishedGoldHomepage(db: Db): Promise<PublicSiteProjection> {
  const { data, error } = await db.rpc('published_gold_homepage');
  if (error) throw new DomainError(error.message, 'public_site.read_failed');
  if (!data) throw new DomainError('No GOLD homepage has been published.', 'public_site.not_published');
  return projection(data);
}

export async function homepagePreview(
  db: Db,
  input: { organizationId: string; revisionId: string },
): Promise<PublicSiteProjection> {
  const { data, error } = await db.rpc('public_homepage_preview', {
    p_organization_id: input.organizationId,
    p_revision_id: input.revisionId,
  });
  if (error) throw new DomainError(error.message, error.code === '42501' ? 'public_site.forbidden' : 'public_site.preview_failed');
  if (!data) throw new DomainError('That website revision does not exist.', 'public_site.revision_missing');
  return projection(data);
}

export async function homepageEditorState(db: Db, organizationId: string): Promise<PublicHomepageEditorState | null> {
  const { data, error } = await db.rpc('public_homepage_editor_state', { p_organization_id: organizationId });
  if (error) throw new DomainError(error.message, error.code === '42501' ? 'public_site.forbidden' : 'public_site.read_failed');
  if (!data) return null;
  const raw = data as unknown as PublicHomepageEditorState;
  for (const revision of [raw.published, raw.working]) {
    if (revision) revision.sections = PublicHomepageSectionsSchema.parse(revision.sections);
  }
  return raw;
}

export async function createHomepageDraft(db: Db, organizationId: string): Promise<string> {
  const { data, error } = await db.rpc('create_public_homepage_draft', { p_organization_id: organizationId });
  if (error || !data) throw new DomainError(error?.message ?? 'The draft was not created.', error?.code === '42501' ? 'public_site.forbidden' : 'public_site.create_failed');
  return data;
}

export async function updateHomepageDraft(
  db: Db,
  input: { organizationId: string; revisionId: string } & PublicHomepageRevisionInput,
): Promise<void> {
  const content = PublicHomepageRevisionSchema.parse({
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    sections: input.sections,
  });
  const { error } = await db.rpc('update_public_homepage_draft', {
    p_organization_id: input.organizationId, p_revision_id: input.revisionId,
    p_seo_title: content.seoTitle, p_seo_description: content.seoDescription, p_sections: content.sections,
  });
  if (error) throw new DomainError(error.message, error.code === '42501' ? 'public_site.forbidden' : 'public_site.update_failed');
}

export async function submitHomepageRevision(db: Db, organizationId: string, revisionId: string): Promise<void> {
  const { error } = await db.rpc('submit_public_homepage_revision', { p_organization_id: organizationId, p_revision_id: revisionId });
  if (error) throw new DomainError(error.message, error.code === '42501' ? 'public_site.forbidden' : 'public_site.transition_failed');
}

export async function publishHomepageRevision(db: Db, organizationId: string, revisionId: string): Promise<void> {
  const { error } = await db.rpc('publish_public_homepage_revision', { p_organization_id: organizationId, p_revision_id: revisionId });
  if (error) throw new DomainError(error.message, error.code === '42501' ? 'public_site.forbidden' : 'public_site.transition_failed');
}
