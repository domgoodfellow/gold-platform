'use server';

import { updateTag, revalidatePath } from 'next/cache';
import { WebsiteContentSchema } from '@gold/schemas';
import { getDb } from '@/lib/db/server';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { GOLD_HOMEPAGE_CACHE_TAG } from '@/lib/domain/public-site/cached';
import { createSiteDraft, createWebsite, discardSiteDraft, publishSiteRevision, submitSiteRevision, updateSiteDraft } from '@/lib/domain/public-site/public-site';

export type WebsiteActionState = { error: string | null; success?: string; /** The refusal was a stale revision: offer to replace the newer one. */ stale?: boolean };

function ids(formData: FormData) {
  return { organizationId: String(formData.get('organizationId') ?? ''), revisionId: String(formData.get('revisionId') ?? '') };
}

function failure(error: unknown): WebsiteActionState {
  if (error instanceof DomainError) return { error: error.message };
  return { error: error instanceof Error ? error.message : 'The website could not be changed.' };
}

const refresh = (organizationId: string) => revalidatePath(`/organizations/${organizationId}/studio/website`);

/** The business creating its own website, blank or from a starter. No hostname is involved. */
export async function createWebsiteAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const { organizationId } = ids(formData);
  await requireOrganization(organizationId);
  const templateKey = String(formData.get('templateKey') ?? '').trim() || null;
  try { await createWebsite(await getDb(), { organizationId, templateKey }); }
  catch (error) { return failure(error); }
  refresh(organizationId);
  return { error: null, success: 'Website created.' };
}

/** A working draft from the published website, or — with `fromRevisionId` — from an earlier revision. */
export async function createDraftAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const { organizationId } = ids(formData);
  await requireOrganization(organizationId);
  const fromRevisionId = String(formData.get('fromRevisionId') ?? '').trim() || null;
  try { await createSiteDraft(await getDb(), { organizationId, fromRevisionId }); }
  catch (error) { return failure(error); }
  refresh(organizationId);
  return { error: null, success: fromRevisionId ? 'Restored as a new draft.' : 'Draft ready.' };
}

export async function saveDraftAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try {
    const parsed = WebsiteContentSchema.safeParse(JSON.parse(String(formData.get('content') ?? 'null')));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'The website could not be saved.' };
    await updateSiteDraft(await getDb(), { ...identity, content: parsed.data });
  } catch (error) { return failure(error); }
  refresh(identity.organizationId);
  return { error: null, success: 'Draft saved.' };
}

export async function submitRevisionAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try { await submitSiteRevision(await getDb(), identity.organizationId, identity.revisionId); }
  catch (error) { return failure(error); }
  refresh(identity.organizationId);
  return { error: null, success: 'Sent for review.' };
}

/**
 * Publishing a revision started before the current published one is refused unless the person
 * confirmed replacing that newer content (`replaceNewer`).
 */
export async function publishRevisionAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  const replaceNewer = formData.get('replaceNewer') === 'true';
  try { await publishSiteRevision(await getDb(), identity.organizationId, identity.revisionId, { replaceNewer }); }
  catch (error) {
    if (error instanceof DomainError && error.code === 'public_site.stale') return { error: error.message, stale: true };
    return failure(error);
  }
  // Draft saves and review transitions never touch public output. This is deliberately the only
  // website action that expires the anonymous projection.
  updateTag(GOLD_HOMEPAGE_CACHE_TAG);
  refresh(identity.organizationId);
  return { error: null, success: 'Published.' };
}

/** Ends the working draft unpublished; it stays in history, read-only. Public output is untouched. */
export async function discardDraftAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try { await discardSiteDraft(await getDb(), identity.organizationId, identity.revisionId); }
  catch (error) { return failure(error); }
  refresh(identity.organizationId);
  return { error: null, success: 'Draft discarded.' };
}
