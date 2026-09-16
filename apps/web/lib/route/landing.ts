import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { organizationHomeHref } from '@/lib/navigation';
import { consumePendingInviteDestination } from '@/lib/route/pending-invite';
import type { Db } from '@/lib/db/types';

/**
 * Where `/organizations` sends somebody, decided as a pure function of two independent facts
 * about one identity (D45) — platform authority and organization membership — never one gating
 * the other's *existence*. Pulled out for the same reason `decideRedirect` (`access.ts`) is: no
 * harness in this repository mounts a server component, so the decision has to be something a
 * test can call directly, with no `NextRequest`, no cookies, and no real session.
 *
 * **The product decision this encodes, stated plainly.** Platform staff default into Platform
 * Administration — regardless of how many businesses they also belong to. Organization
 * membership does not disappear and is not weakened by this (D45's actual guarantee, untouched:
 * a staff member can still open, work inside, and hold real capabilities in any business they are
 * a member of). What changed is only which of a staff member's two true contexts is the one they
 * land in first. `showAll` (`/organizations?all=1`, the switcher's own "All businesses" link) is
 * the one explicit override: asking for the list is asking to choose, and choosing always shows
 * every option — including Platform Administration itself, alongside every business.
 *
 * An earlier version of this file said platform authority "never overrides organization context"
 * and auto-entered a staff member's one business exactly as it would a tenant-only caller's. That
 * was itself a corrected regression (a still-earlier version sent staff to `/platform`
 * unconditionally, before their memberships were even read) — but the corrected behavior turned
 * out to be the wrong default for a console this repository's own staff use daily: an
 * administrator who also happens to belong to one demo business kept landing inside that
 * business instead of the console they actually meant to reach. This is the amendment. It is not
 * a reversion to the original bug — a staff member with organizations is never blocked from any
 * of them, only no longer auto-entered into one by default.
 */
export type OrganizationsLanding =
  | { kind: 'onboarding' }
  | { kind: 'platform' }
  | { kind: 'enter'; organizationId: string }
  | { kind: 'chooser' };

export function resolveOrganizationsLanding(input: {
  organizations: readonly { id: string }[];
  staff: boolean;
  /** `?all=1` — the shell's own *All businesses* link, asking for the chooser explicitly even
   * where staff or a single-organization caller would otherwise be sent straight in. */
  showAll: boolean;
}): OrganizationsLanding {
  const { organizations, staff, showAll } = input;

  if (staff && !showAll) {
    return { kind: 'platform' };
  }

  if (organizations.length === 0) {
    // Reached either by a tenant-only caller with nothing to enter, or by staff who explicitly
    // asked for the chooser (`showAll`) and have no business to show inside it — onboarding is
    // the only thing either identity can do here.
    return { kind: 'onboarding' };
  }

  if (organizations.length === 1 && !showAll) {
    return { kind: 'enter', organizationId: organizations[0].id };
  }

  return { kind: 'chooser' };
}

function destinationFor(landing: OrganizationsLanding): string {
  switch (landing.kind) {
    case 'platform':
      return '/platform';
    case 'enter':
      return organizationHomeHref(landing.organizationId);
    case 'onboarding':
    case 'chooser':
      return '/organizations';
  }
}

/**
 * The one post-authentication destination rule, called by every path that just established a
 * session — password sign-in and the Google OAuth callback alike — so the decision lives in
 * exactly one place rather than being re-derived (or drifting) per entry point.
 *
 * Priority, in order: an explicit pending invite outranks everything (someone who just followed
 * an invitation link meant to land there, not wherever their identity would otherwise default
 * to); then `resolveOrganizationsLanding` with `showAll: false`, since nobody has asked for the
 * chooser yet at the moment they sign in.
 *
 * `/organizations` itself still exists as the chooser and still calls
 * `resolveOrganizationsLanding` directly (with the real `showAll` from its own query string) —
 * this function is the shortcut that skips the extra hop through that page for the common case,
 * not a second implementation of its logic.
 */
export async function resolvePostAuthDestination(db: Db): Promise<string> {
  const invite = await consumePendingInviteDestination();
  if (invite) return invite;

  const [staff, organizations] = await Promise.all([isPlatformStaff(db), listMyOrganizations(db)]);
  return destinationFor(resolveOrganizationsLanding({ organizations, staff, showAll: false }));
}
