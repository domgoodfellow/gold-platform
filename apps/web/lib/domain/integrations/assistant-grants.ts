import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Which resources GOLD's assistant may read. A connection grants nothing on its own: each resource
 * is named here by somebody with `integration.manage`, and absence is the default. What the
 * assistant may actually do is decided by `assistant_may_read_resource`, which also requires the
 * resource and its connection to be active.
 */

/** The ids of the granted resources in one connection. */
export async function listGrantedResourceIds(
  db: Db,
  input: { organizationId: string; resourceIds: readonly string[] },
): Promise<Set<string>> {
  if (input.resourceIds.length === 0) return new Set();
  const { data, error } = await db
    .from('assistant_resource_grants')
    .select('resource_id')
    .eq('organization_id', input.organizationId)
    .in('resource_id', [...input.resourceIds]);
  if (error) throw fromDatabaseError(error, 'integrations.grants_list_failed');
  return new Set((data ?? []).map((row) => row.resource_id));
}

export async function setAssistantAccess(
  db: Db,
  input: { organizationId: string; resourceId: string; allowed: boolean },
): Promise<void> {
  const actor = await requireActor(db);

  if (input.allowed) {
    const { error } = await db.from('assistant_resource_grants').upsert(
      { organization_id: input.organizationId, resource_id: input.resourceId, granted_by: actor.id },
      { onConflict: 'organization_id,resource_id', ignoreDuplicates: true },
    );
    if (error) throw grantError(error);
    return;
  }

  const { error } = await db
    .from('assistant_resource_grants')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('resource_id', input.resourceId);
  if (error) throw grantError(error);
}

export async function assistantMayRead(db: Db, input: { organizationId: string; resourceId: string }): Promise<boolean> {
  const { data, error } = await db.rpc('assistant_may_read_resource', {
    p_organization_id: input.organizationId,
    p_resource_id: input.resourceId,
  });
  if (error) throw fromDatabaseError(error, 'integrations.grant_check_failed');
  return data === true;
}

function grantError(error: { code?: string; message: string }): DomainError {
  if (error.code === '42501') return new DomainError('You cannot change what the assistant may read here.', 'integrations.forbidden');
  return fromDatabaseError(error, 'integrations.grant_failed');
}
