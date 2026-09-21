'use server';

import { updateTag, revalidatePath } from 'next/cache';
import { PublicHomepageRevisionSchema } from '@gold/schemas';
import { getDb } from '@/lib/db/server';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { GOLD_HOMEPAGE_CACHE_TAG } from '@/lib/domain/public-site/cached';
import { createHomepageDraft, publishHomepageRevision, submitHomepageRevision, updateHomepageDraft } from '@/lib/domain/public-site/public-site';

export type WebsiteActionState = { error: string | null; success?: string };
export type CommunicationProfileState = WebsiteActionState;

function ids(formData: FormData) {
  return { organizationId: String(formData.get('organizationId') ?? ''), revisionId: String(formData.get('revisionId') ?? '') };
}

function failure(error: unknown): WebsiteActionState {
  if (error instanceof DomainError) return { error: error.message };
  return { error: error instanceof Error ? error.message : 'The website could not be changed.' };
}

export async function createDraftAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const { organizationId } = ids(formData);
  await requireOrganization(organizationId);
  try { await createHomepageDraft(await getDb(), organizationId); }
  catch (error) { return failure(error); }
  revalidatePath(`/organizations/${organizationId}/settings/website`);
  return { error: null, success: 'Draft ready.' };
}

export async function saveDraftAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try {
    const content = PublicHomepageRevisionSchema.parse({
      seoTitle: formData.get('seoTitle'), seoDescription: formData.get('seoDescription'),
      sections: JSON.parse(String(formData.get('sections') ?? 'null')),
    });
    await updateHomepageDraft(await getDb(), { ...identity, ...content });
  } catch (error) { return failure(error); }
  revalidatePath(`/organizations/${identity.organizationId}/settings/website`);
  return { error: null, success: 'Draft saved.' };
}

export async function submitRevisionAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try { await submitHomepageRevision(await getDb(), identity.organizationId, identity.revisionId); }
  catch (error) { return failure(error); }
  revalidatePath(`/organizations/${identity.organizationId}/settings/website`);
  return { error: null, success: 'Sent for review.' };
}

export async function publishRevisionAction(_state: WebsiteActionState, formData: FormData): Promise<WebsiteActionState> {
  const identity = ids(formData);
  await requireOrganization(identity.organizationId);
  try { await publishHomepageRevision(await getDb(), identity.organizationId, identity.revisionId); }
  catch (error) { return failure(error); }
  // Draft saves and review transitions never touch public output. This is deliberately the only
  // website action that expires the anonymous projection.
  updateTag(GOLD_HOMEPAGE_CACHE_TAG);
  revalidatePath(`/organizations/${identity.organizationId}/settings/website`);
  return { error: null, success: 'Published.' };
}

export async function saveCommunicationProfileAction(_state: CommunicationProfileState, formData: FormData): Promise<CommunicationProfileState> {
  const organizationId=String(formData.get('organizationId')??''); const siteId=String(formData.get('siteId')??'');
  await requireOrganization(organizationId);
  try { const db=await getDb(); const rpc=db.rpc.bind(db) as unknown as (name:string,args?:Record<string,unknown>)=>Promise<{error:{message:string}|null}>; const result=await rpc('update_public_communication_profile',{p_organization_id:organizationId,p_site_id:siteId,p_enabled:formData.get('enabled')==='on',p_display_name:String(formData.get('displayName')??''),p_greeting:String(formData.get('greeting')??''),p_instructions:String(formData.get('instructions')??''),p_handoff_message:String(formData.get('handoffMessage')??''),p_handoff_destination:String(formData.get('handoffDestination')??'')}); if(result.error) throw new DomainError(result.error.message,'communications.profile_save_failed'); }
  catch(error){return failure(error);} revalidatePath(`/organizations/${organizationId}/settings/website`); return {error:null,success:'Website messaging saved.'};
}
