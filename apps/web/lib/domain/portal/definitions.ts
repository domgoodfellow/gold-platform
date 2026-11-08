import type { Db, Database } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { parsePortalContent, type PortalContent } from './composition';

export type PortalDefinition = Database['public']['Tables']['portal_definitions']['Row'];
export type PortalRevision = Database['public']['Tables']['portal_revisions']['Row'];
export type PortalAvailability = { work: boolean; invoices: boolean; forms: boolean; services: boolean; payments: boolean; publish: boolean; defaultExperience: boolean };
export async function portalHistoryBefore(db: Db, organizationId: string, beforeNumber: number): Promise<PortalRevision[]> {
  const {data,error}=await db.from('portal_revisions').select('*').eq('organization_id',organizationId).lt('number',beforeNumber).order('number',{ascending:false}).limit(50);
  if(error)throw new DomainError('Portal history could not be loaded.','portal.read_failed');
  return data ?? [];
}
export async function portalEditorState(db: Db, organizationId: string) {
  const [definition, history] = await Promise.all([
    db.from('portal_definitions').select('*').eq('organization_id', organizationId).maybeSingle(),
    db.from('portal_revisions').select('*').eq('organization_id', organizationId).order('number', { ascending: false }).limit(50),
  ]);
  if (definition.error || history.error) throw new DomainError('Portal could not be loaded.', 'portal.read_failed');
  return { definition: definition.data, history: history.data ?? [] };
}
export async function savePortalDraft(db: Db, organizationId: string, version: number, content: PortalContent) {
  const { error } = await db.rpc('save_portal_draft', { p_organization_id: organizationId, p_expected_version: version, p_content: parsePortalContent(content) });
  if (error) throw fromDatabaseError(error, 'portal.save_failed');
}
export async function submitPortalDraft(db: Db, organizationId: string, version: number) {
  const { error } = await db.rpc('submit_portal_draft', { p_organization_id: organizationId, p_expected_version: version });
  if (error) throw fromDatabaseError(error, 'portal.review_failed');
}
export async function publishPortalDraft(db: Db, organizationId: string, version: number) {
  const { error } = await db.rpc('publish_portal_draft', { p_organization_id: organizationId, p_expected_version: version });
  if (error) throw fromDatabaseError(error, 'portal.publish_failed');
}
export async function unpublishPortal(db: Db, organizationId: string, version: number) {
  const { error } = await db.rpc('unpublish_portal', { p_organization_id: organizationId, p_expected_version: version });
  if (error) throw fromDatabaseError(error, 'portal.unpublish_failed');
}
export async function publishedPortalContent(db: Db): Promise<PortalContent | null> {
  const { data, error } = await db.rpc('portal_published_composition');
  if (error) throw new DomainError('Portal could not be loaded.', 'portal.read_failed');
  return data ? parsePortalContent(data) : null;
}
export async function portalModuleAvailability(db: Db, organizationId?: string): Promise<PortalAvailability> {
  const { data, error } = await db.rpc('portal_module_availability', organizationId ? { p_organization_id: organizationId } : {});
  if (error) throw new DomainError('Portal availability could not be loaded.', 'portal.read_failed');
  return data as unknown as PortalAvailability;
}
