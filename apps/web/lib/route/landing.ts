/**
 * Where `/organizations` sends somebody, decided as a pure function of two independent facts
 * about one identity (D45) — platform authority and organization membership — rather than one
 * gating the other. Pulled out for the same reason `decideRedirect` (`access.ts`) is: no harness
 * in this repository mounts a server component, so the decision the regression was in has to be
 * something a test can call directly, with no `NextRequest`, no cookies, and no real session.
 *
 * The regression this exists to catch: a caller with platform authority used to redirect to
 * `/platform` unconditionally, before their own organization memberships were even read — so a
 * person who ran GOLD *and* belonged to a business could never land in it. Platform authority is
 * additional context, never one that overrides organization context.
 */
export type OrganizationsLanding =
  | { kind: 'onboarding' }
  | { kind: 'platform' }
  | { kind: 'enter'; organizationId: string }
  | { kind: 'chooser' };

export function resolveOrganizationsLanding(input: {
  organizations: readonly { id: string }[];
  staff: boolean;
  /** `?all=1` — the shell's own *Switch business* link, asking for the list even when it would otherwise auto-enter. */
  showAll: boolean;
}): OrganizationsLanding {
  const { organizations, staff, showAll } = input;

  // The one case with nothing for this page to show: no organization to list and platform
  // authority to fall back into instead. Every other zero-organization identity sees onboarding
  // regardless of staff, because there is nothing to enter and nothing to offer instead.
  if (organizations.length === 0) {
    return staff ? { kind: 'platform' } : { kind: 'onboarding' };
  }

  if (organizations.length === 1 && !showAll) {
    return { kind: 'enter', organizationId: organizations[0].id };
  }

  return { kind: 'chooser' };
}
