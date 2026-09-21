import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { platformBillingEnvironment } from '@/lib/adapters/platform-billing';
import { getDb } from '@/lib/db/server';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  getOrganizationServiceAccess,
  type ServiceAccess,
} from '@/lib/domain/platform-billing/service-access';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization, type Organization } from '@/lib/domain/tenancy/organizations';

/**
 * Where a business whose commercial service access is locked is sent. Under Settings → Plan &
 * usage because that is where recovery lives; it is the one page here that does not enforce.
 */
export function serviceLockedHref(organizationId: string): string {
  return `/organizations/${organizationId}/settings/plan/locked`;
}

/**
 * Membership only — the session is real and the organization is one the caller belongs to. This
 * says nothing about whether the business may currently use GOLD; that is `requireOrganization`.
 *
 * `cache` makes repeated calls within one request a single round trip.
 */
const resolveMembership = cache(
  async (organizationId: string): Promise<{ db: Db; organization: Organization }> => {
    const db = await getDb();

    try {
      await requireActor(db);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'auth.required') {
        redirect('/login');
      }
      throw error;
    }

    // Null covers "no such organization" and "not yours" indistinguishably — RLS simply
    // returns no row, and a caller must not be able to tell the two apart.
    const organization = await getOrganization(db, organizationId);
    if (!organization) {
      notFound();
    }

    return { db, organization };
  },
);

const resolveServiceAccess = cache(async (organizationId: string): Promise<ServiceAccess> => {
  const { db } = await resolveMembership(organizationId);
  return getOrganizationServiceAccess(db, {
    organizationId,
    environment: platformBillingEnvironment(),
  });
});

/**
 * The guard every operational screen and server action inside one business runs. Every page
 * calls this itself rather than relying on its layout — Next reuses a layout across client
 * navigations without re-rendering it, so a page trusting its parent for authorization would be
 * trusting a cache; RLS is the real boundary for *data*, and this is the boundary for *service*.
 *
 * Two questions, in order: is the caller a member (404 otherwise), and may this business
 * currently use GOLD (`service-access.ts`; the locked screen otherwise). A locked business
 * keeps its data untouched — this only refuses to open the door.
 */
export const requireOrganization = cache(
  async (organizationId: string): Promise<{ db: Db; organization: Organization }> => {
    const membership = await resolveMembership(organizationId);
    const access = await resolveServiceAccess(organizationId);
    if (!access.permitted) {
      redirect(serviceLockedHref(organizationId));
    }
    return membership;
  },
);

/**
 * The same membership proof without the service question, and the only way around it. For the
 * places that must work while service is locked: the shell layout (which draws the locked
 * experience), Plan & usage, the checkout and portal actions, and the locked screen itself —
 * the billing-recovery surface. Guarding those with `requireOrganization` would make recovery
 * unreachable from the state it exists for. Hands back the access state so a caller can adapt.
 */
export async function requireOrganizationForBillingRecovery(
  organizationId: string,
): Promise<{ db: Db; organization: Organization; access: ServiceAccess }> {
  const membership = await resolveMembership(organizationId);
  const access = await resolveServiceAccess(organizationId);
  return { ...membership, access };
}
