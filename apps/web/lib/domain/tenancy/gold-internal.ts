import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getPlanById } from '@/lib/domain/catalogue/plans';

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
