import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { organizationHomeHref } from '@/lib/navigation';
import { cookies } from 'next/headers';
import { LAST_ORGANIZATION_COOKIE } from '@/lib/route/last-organization';
import { consumePendingInviteDestination } from '@/lib/route/pending-invite';
import { readChosenPlan } from '@/lib/route/chosen-plan';
import type { Db } from '@/lib/db/types';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';
import { awaitsFirstReview, currentConfigurationProposal } from '@/lib/domain/configuration/proposals';

/**
 * Where `/organizations` sends somebody, decided from their real organization memberships. A
 * member of GildOps' operating organization lands there first; Administration is a context of
 * that organization, so platform authority adds no destination of its own and never stands in
 * for a membership.
 *
 * This is where a *sign-in* lands, never how somebody switches context: that is the context
 * switcher, which links straight to a business. There is no directory outcome:
 * the only page `/organizations` still renders is the one that founds a first business.
 */
export type OrganizationsLanding =
  | { kind: 'onboarding' }
  | { kind: 'enter'; organizationId: string; operationalState: OperationalState };

export function resolveOrganizationsLanding(input: {
  organizations: readonly { id: string; operationalState: OperationalState }[];
  preferredOrganizationId?: string | null;
  /** The business last worked in (`last-organization.ts`). Honoured only if the caller is a member. */
  lastOrganizationId?: string | null;
}): OrganizationsLanding {
  const { organizations, preferredOrganizationId, lastOrganizationId } = input;

  const preferred = preferredOrganizationId
    ? organizations.find((org) => org.id === preferredOrganizationId)
    : undefined;
  if (preferred) {
    return { kind: 'enter', organizationId: preferred.id, operationalState: preferred.operationalState };
  }

  if (organizations.length === 0) {
    return { kind: 'onboarding' };
  }

  // One membership is not a choice, and neither is several: land in the one last worked in, else
  // the first. A person moves between them with the context switcher, not a directory page.
  const remembered = lastOrganizationId ? organizations.find((org) => org.id === lastOrganizationId) : undefined;
  const entry = remembered ?? organizations[0];
  return { kind: 'enter', organizationId: entry.id, operationalState: entry.operationalState };
}

/** The one place a landing becomes a URL — pure, so a SETUP and a LIVE business can be told apart without a session. */
export function destinationFor(landing: OrganizationsLanding): string {
  switch (landing.kind) {
    case 'enter':
      return organizationHomeHref(landing.organizationId, landing.operationalState);
    case 'onboarding':
      return '/organizations';
  }
}

/**
 * Where entering a business lands. The one exception to its home: a business GildOps prepared a
 * starting setup for, whose owner has not looked at it yet, opens that setup for review. Applying,
 * discarding or "Not now" ends it, so it is a first visit, never a route that keeps somebody out.
 */
export async function entryDestination(db: Db, landing: OrganizationsLanding): Promise<string> {
  return await firstReviewHref(db, landing) ?? destinationFor(landing);
}

/** The review a business entered for the first time opens on, or null when it opens on its home. */
export async function firstReviewHref(db: Db, landing: OrganizationsLanding): Promise<string | null> {
  if (landing.kind === 'enter' && landing.operationalState === 'setup'
    && awaitsFirstReview(await currentConfigurationProposal(db, { organizationId: landing.organizationId }))) {
    return `/organizations/${landing.organizationId}/setup/proposal`;
  }
  return null;
}

export async function readLastOrganizationId(): Promise<string | null> {
  return (await cookies()).get(LAST_ORGANIZATION_COOKIE)?.value ?? null;
}

/** Where a sign-in lands. The remembered business is read here and, on `/organizations`, by the page. */
export async function resolvePostAuthDestination(db: Db): Promise<string> {
  const invite = await consumePendingInviteDestination();
  if (invite) return invite;
  // A plan chosen on Pricing founds a new business, even for someone who already runs one.
  if (await readChosenPlan()) return '/organizations';

  const [organizations, preferredOrganization] = await Promise.all([listMyOrganizations(db), callerOperatingOrganization(db)]);
  return entryDestination(
    db,
    resolveOrganizationsLanding({
      organizations,
      preferredOrganizationId: preferredOrganization?.id,
      lastOrganizationId: await readLastOrganizationId(),
    }),
  );
}
