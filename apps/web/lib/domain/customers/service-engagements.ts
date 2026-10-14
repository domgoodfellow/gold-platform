import type { Database, Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export const SERVICE_KINDS = { website: 'Website', ai: 'AI', automation: 'Automation', integration: 'Integration', implementation: 'Implementation', managed_operations: 'Managed operations' } as const;
export type ServiceKind = keyof typeof SERVICE_KINDS;
export type Engagement = Database['public']['Tables']['service_engagements']['Row'];
export type Deliverable = Database['public']['Functions']['engagement_deliverable_summaries']['Returns'][number];
export type DeliverableOption = Database['public']['Functions']['service_deliverable_options']['Returns'][number];
export const ARTIFACT_KINDS = { website: 'Website', form: 'Form', ai_deployment: 'AI deployment', automation: 'Automation', portal: 'Customer portal' } as const;
export type ArtifactKind = keyof typeof ARTIFACT_KINDS;

export async function listServiceEngagements(db: Db, organizationId: string, customerId: string) {
  const { data, error, count } = await db.from('service_engagements').select('*', { count: 'exact' }).eq('organization_id', organizationId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new DomainError(error.message, 'engagement.read_failed');
  return { items: data ?? [], total: count };
}

export async function getServiceEngagement(db: Db, organizationId: string, customerId: string, engagementId: string): Promise<Engagement | null> {
  const { data, error } = await db.from('service_engagements').select('*').eq('organization_id', organizationId).eq('customer_id', customerId).eq('id', engagementId).maybeSingle();
  if (error) throw new DomainError(error.message, 'engagement.read_failed');
  return data;
}

export async function createServiceEngagement(db: Db, input: { organizationId: string; customerId: string; name: string; serviceKind: ServiceKind; relationshipId?: string; opportunityId?: string; proposalId?: string }): Promise<string> {
  if (!input.name.trim()) throw new DomainError('Enter an engagement name.', 'engagement.name_required');
  if (input.name.trim().length > 200) throw new DomainError('Use an engagement name of 200 characters or fewer.', 'engagement.name_too_long');
  const { data, error } = await db.rpc('create_service_engagement', { p_organization_id: input.organizationId, p_customer_id: input.customerId, p_name: input.name, p_service_kind: input.serviceKind, p_relationship_id: input.relationshipId, p_opportunity_id: input.opportunityId, p_proposal_id: input.proposalId });
  if (error) throw new DomainError(error.message, 'engagement.create_failed');
  return data;
}

export async function transitionServiceEngagement(db: Db, organizationId: string, engagementId: string, status: 'active' | 'completed' | 'cancelled'): Promise<void> {
  const { error } = await db.rpc('transition_service_engagement', { p_organization_id: organizationId, p_engagement_id: engagementId, p_status: status });
  if (error) throw new DomainError(error.message, 'engagement.transition_failed');
}

export async function bindServiceEngagementTenant(db: Db, organizationId: string, engagementId: string, relationshipId: string): Promise<void> {
  const { error } = await db.rpc('bind_service_engagement_tenant', { p_organization_id: organizationId, p_engagement_id: engagementId, p_relationship_id: relationshipId });
  if (error) throw new DomainError(error.message, 'engagement.bind_failed');
}

export async function listEngagementDeliverables(db: Db, organizationId: string, engagementId: string): Promise<Deliverable[]> {
  const { data, error } = await db.rpc('engagement_deliverable_summaries', { p_organization_id: organizationId, p_engagement_id: engagementId });
  if (error) throw new DomainError(error.message, 'engagement.deliverables_failed');
  return data ?? [];
}

export async function listDeliverableOptions(db: Db, organizationId: string, engagementId: string, search = ''): Promise<DeliverableOption[]> {
  const { data, error } = await db.rpc('service_deliverable_options', { p_organization_id: organizationId, p_engagement_id: engagementId, p_search: search });
  if (error) throw new DomainError(error.message, 'engagement.options_failed');
  return data ?? [];
}

export async function attachEngagementDeliverable(db: Db, organizationId: string, engagementId: string, kind: ArtifactKind, artifactId: string): Promise<string> {
  const { data, error } = await db.rpc('attach_engagement_deliverable', { p_organization_id: organizationId, p_engagement_id: engagementId, p_kind: kind, p_artifact_id: artifactId });
  if (error) throw new DomainError(error.code === '23505' ? 'This deliverable is already attached to the engagement.' : error.message, 'engagement.attach_failed');
  return data;
}

export async function attachEngagementWork(db: Db, organizationId: string, engagementId: string, workItemId: string): Promise<void> {
  const { error } = await db.rpc('attach_engagement_work', { p_organization_id: organizationId, p_engagement_id: engagementId, p_work_item_id: workItemId });
  if (error) throw new DomainError(error.code === '23505' ? 'This Work Item is already attached to the engagement.' : error.message, 'engagement.work_failed');
}
