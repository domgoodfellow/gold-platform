import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { organizationHomeHref } from '@/lib/navigation';
import { consumePendingInviteDestination } from '@/lib/route/pending-invite';
import type { Db } from '@/lib/db/types';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';

/**
 * Where `/organizations` sends somebody, decided from two independent facts about one identity:
 * platform authority and real organization membership. Platform authority does not invent GOLD
 * membership; when the membership exists, GOLD is the operating workspace. Without it, `/platform`
 * is still the global route namespace and renders the bootstrap-required state.
 */
export type OrganizationsLanding =
  | { kind: 'onboarding' }
  | { kind: 'platform' }
  | { kind: 'enter'; organizationId: string; operationalState: OperationalState }
  | { kind: 'chooser' };

export function resolveOrganizationsLanding(input: {
  organizations: readonly { id: string; operationalState: OperationalState }[];
  staff: boolean;
  preferredOrganizationId?: string | null;
  showAll: boolean;
}): OrganizationsLanding {
  const { organizations, staff, preferredOrganizationId, showAll } = input;

  const preferred = preferredOrganizationId
    ? organizations.find((org) => org.id === preferredOrganizationId)
    : undefined;
  if (!showAll && preferred) {
    return { kind: 'enter', organizationId: preferred.id, operationalState: preferred.operationalState };
  }

  if (staff && !showAll) {
    return { kind: 'platform' };
  }

  if (organizations.length === 0) {
    return { kind: 'onboarding' };
  }

  if (organizations.length === 1 && !showAll) {
    return { kind: 'enter', organizationId: organizations[0].id, operationalState: organizations[0].operationalState };
  }

  return { kind: 'chooser' };
}

/** The one place a landing becomes a URL — pure, so a SETUP and a LIVE business can be told apart without a session. */
export function destinationFor(landing: OrganizationsLanding): string {
  switch (landing.kind) {
    case 'platform':
      return '/platform';
    case 'enter':
      return organizationHomeHref(landing.organizationId, landing.operationalState);
    case 'onboarding':
    case 'chooser':
      return '/organizations';
  }
}

export async function resolvePostAuthDestination(db: Db): Promise<string> {
  const invite = await consumePendingInviteDestination();
  if (invite) return invite;

  const [staff, organizations] = await Promise.all([isPlatformStaff(db), listMyOrganizations(db)]);
  const preferredOrganization = await findGoldInternalOrganization(db, organizations);
  return destinationFor(
    resolveOrganizationsLanding({
      organizations,
      staff,
      preferredOrganizationId: preferredOrganization?.id,
      showAll: false,
    }),
  );
}
