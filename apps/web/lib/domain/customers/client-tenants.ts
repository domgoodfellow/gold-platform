import type { Database, Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export type ClientTenantRelationship = Omit<Database['public']['Functions']['client_tenant_summaries']['Returns'][number], 'ended_at'> & { ended_at: string | null };

export async function getClientTenantRelationships(db: Db, organizationId: string, customerId: string): Promise<ClientTenantRelationship[]> {
  const { data, error } = await db.rpc('client_tenant_summaries', { p_organization_id: organizationId, p_customer_id: customerId });
  if (error) throw new DomainError(error.message, 'client_tenant.read_failed');
  return data ?? [];
}

export async function listExistingTenantOptions(db: Db, organizationId: string, customerId: string, search = '') {
  const { data, error } = await db.rpc('existing_client_tenant_options', { p_organization_id: organizationId, p_customer_id: customerId, p_search: search });
  if (error) throw new DomainError('Organization search could not be loaded.', 'client_tenant.search_failed');
  return data ?? [];
}

export async function linkExistingTenant(db: Db, input: { organizationId: string; customerId: string; tenantId: string; authorityBasis: string }): Promise<string> {
  const { data, error } = await db.rpc('link_existing_client_tenant', { p_organization_id: input.organizationId, p_customer_id: input.customerId, p_tenant_id: input.tenantId, p_authority_basis: input.authorityBasis });
  if (error) throw new DomainError(error.code === '23505' ? 'This customer already has an active relationship with that organization.' : error.message, 'client_tenant.link_failed');
  return data;
}

export async function endClientTenantRelationship(db: Db, organizationId: string, relationshipId: string): Promise<void> {
  const { error } = await db.rpc('end_client_tenant_relationship', { p_organization_id: organizationId, p_relationship_id: relationshipId });
  if (error) throw new DomainError(error.message, 'client_tenant.end_failed');
}
