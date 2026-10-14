'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { parsePortalContent } from '@/lib/domain/portal/composition';
import { savePortalDraft, publishPortalDraft, unpublishPortal, submitPortalDraft, portalHistoryBefore } from '@/lib/domain/portal/definitions';

export type PortalActionState = { error: string | null; success?: string };
export async function readPortalHistory(organizationId: string, beforeNumber: number) {
  const {db,organization}=await requireOrganization(organizationId);
  if(!organization.capabilities.includes('organization.manage'))throw new DomainError('Organization management required.','portal.forbidden');
  if(!Number.isSafeInteger(beforeNumber)||beforeNumber<1||beforeNumber>2147483647)throw new DomainError('Reload Portal history.','portal.invalid_version');
  return portalHistoryBefore(db,organizationId,beforeNumber);
}
export async function portalAction(_previous: PortalActionState, form: FormData): Promise<PortalActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);
  try {
    if (!organization.capabilities.includes('organization.manage')) throw new DomainError('Organization management required.', 'portal.forbidden');
    const version = Number(form.get('version'));
    if (!Number.isSafeInteger(version) || version < 0) throw new DomainError('Reload the Portal editor.', 'portal.invalid_version');
    const operation = String(form.get('operation') ?? '');
    let success: string;
    if (operation === 'save') {
      let content: unknown;
      try { content = JSON.parse(String(form.get('content') ?? '')); }
      catch { throw new DomainError('Invalid portal composition.', 'portal.invalid_content'); }
      await savePortalDraft(db, organizationId, version, parsePortalContent(content));
      success = 'Draft saved.';
    } else if (operation === 'review') {
      await submitPortalDraft(db, organizationId, version); success = 'Draft sent for review.';
    } else if (operation === 'publish') {
      await publishPortalDraft(db, organizationId, version); success = 'Portal published.';
    } else if (operation === 'unpublish') {
      await unpublishPortal(db, organizationId, version); success = 'Portal unpublished.';
    } else if (operation === 'restore') {
      const { data, error } = await db.from('portal_revisions').select('content').eq('organization_id', organizationId).eq('id', String(form.get('revisionId') ?? '')).maybeSingle();
      if (error || !data) throw new DomainError('Revision unavailable.', 'portal.revision_unavailable');
      await savePortalDraft(db, organizationId, version, parsePortalContent(data.content)); success = 'Revision restored to draft. Publish when ready.';
    } else throw new DomainError('Unsupported operation.', 'portal.invalid_operation');
    revalidatePath(`/organizations/${organizationId}/studio/portal`);
    revalidatePath(`/organizations/${organizationId}/studio`);
    revalidatePath('/portal');
    return { error: null, success };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
