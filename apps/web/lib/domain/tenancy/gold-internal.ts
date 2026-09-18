import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getPlanById } from '@/lib/domain/catalogue/plans';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FOUNDING_ROLE } from '@/lib/domain/tenancy/organizations';

/**
 * Finds the caller's real GOLD operating workspace from its current base Plan, never its name.
 * The supplied organizations come from `listMyOrganizations`, so platform authority alone cannot
 * make an organization eligible.
 */
export async function findGoldInternalOrganization(
  db: Db,
  organizations: readonly { id: string }[],
): Promise<{ id: string } | null> {
  const matches: { id: string }[] = [];

  for (const organization of organizations) {
    const assignment = await currentPlanAssignment(db, { organizationId: organization.id });
    if (!assignment) continue;
    const plan = await getPlanById(db, assignment.planId);
    if (plan?.key === 'gold_internal') matches.push({ id: organization.id });
  }

  if (matches.length > 1) {
    throw new DomainError(
      'More than one organization has the current GOLD Internal Plan.',
      'gold_internal.multiple_organizations',
    );
  }
  return matches[0] ?? null;
}

export async function bootstrapGoldInternalWorkspace(
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
        'Only platform staff may initialize the GOLD operating workspace.',
        'gold_internal.bootstrap_forbidden',
      );
    }
    if (error.code === '23505') {
      throw new DomainError(
        'Another organization already has the current GOLD Internal Plan.',
        'gold_internal.bootstrap_duplicate',
      );
    }
    if (error.code === '23P01') {
      throw new DomainError(
        'That organization already has a conflicting current base Plan.',
        'gold_internal.bootstrap_plan_conflict',
      );
    }
    if (error.code === '23503') {
      throw new DomainError(
        'No such organization or GOLD Internal Plan.',
        'gold_internal.bootstrap_not_found',
      );
    }
    throw new DomainError(error.message, 'gold_internal.bootstrap_failed');
  }

  return data as string;
}
