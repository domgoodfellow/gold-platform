import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FOUNDING_ROLE } from '@/lib/domain/tenancy/organizations';

/**
 * GildOps' own operating organization, when the caller is a member of it.
 *
 * The identity is platform configuration (`platform_settings.operating_organization_id`), so a
 * Plan, a name or platform authority cannot make an organization GildOps. Null when the
 * deployment has designated none or the caller is not a member; a non-member is never told which
 * organization it is. Platform authority is a separate question: `platformPermissions`.
 */
export async function callerOperatingOrganization(db: Db): Promise<{ id: string } | null> {
  const { data, error } = await db.rpc('caller_operating_organization_id');
  // An unreadable identity is not "not GildOps": callers would quietly drop Platform with nothing
  // to say why.
  if (error) {
    throw new DomainError(
      `The GildOps operating organization could not be read: ${error.message}`,
      'operating_organization.unreadable',
    );
  }
  return data ? { id: data } : null;
}

/** Whether this organization is GildOps' operating organization and the caller is a member of it. */
export async function isOperatingOrganization(db: Db, input: { organizationId: string }): Promise<boolean> {
  return (await callerOperatingOrganization(db))?.id === input.organizationId;
}

/**
 * Designates GildOps' operating organization, or confirms it is this one, then repairs the
 * caller's own membership. Refused once another organization holds the identity.
 */
export async function bootstrapOperatingOrganization(
  db: Db,
  input: { organizationId: string },
): Promise<string> {
  const { data, error } = await db.rpc('bootstrap_gold_internal_workspace', {
    p_organization_id: input.organizationId,
    p_role: FOUNDING_ROLE,
    p_capabilities: ALL_CAPABILITIES,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'Only platform staff may initialize the GildOps operating organization.',
        'operating_organization.bootstrap_forbidden',
      );
    }
    if (error.code === '23505') {
      throw new DomainError(
        'Another organization is already the GildOps operating organization.',
        'operating_organization.bootstrap_conflict',
      );
    }
    if (error.code === '23P01') {
      throw new DomainError(
        'That organization already has a conflicting current base Plan.',
        'operating_organization.bootstrap_plan_conflict',
      );
    }
    if (error.code === '23503') {
      throw new DomainError(
        'No such organization or GOLD Internal Plan.',
        'operating_organization.bootstrap_not_found',
      );
    }
    throw new DomainError(error.message, 'operating_organization.bootstrap_failed');
  }

  return data as string;
}
