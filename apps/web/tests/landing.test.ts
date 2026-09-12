import { describe, expect, it } from 'vitest';
import { resolveOrganizationsLanding } from '@/lib/route/landing';

/**
 * The regression: `/organizations` used to redirect a caller with platform authority straight
 * to `/platform`, before their own organization memberships were even read — so a person who
 * both ran GOLD and belonged to a business could never land in that business. D45 made platform
 * authority and organization membership two independent facts about one identity; neither
 * overrides the other, and this is the pure decision that proves it for every combination, with
 * no session and no database (`session-identity.test.ts`'s `decideRedirect` is the same shape of
 * test for the same reason: no harness here mounts a server component).
 */
describe('resolveOrganizationsLanding', () => {
  it('sends a caller with no organizations and no platform authority to onboarding', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: false, showAll: false })).toEqual({
      kind: 'onboarding',
    });
  });

  it('sends a caller with no organizations and platform authority to /platform', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
  });

  it('enters the one organization a tenant-only caller belongs to', () => {
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: false, showAll: false }),
    ).toEqual({ kind: 'enter', organizationId: 'org-1' });
  });

  it('enters that same one organization for a caller who also holds platform authority', () => {
    // The exact case the regression broke: platform authority must not pre-empt this.
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: true, showAll: false }),
    ).toEqual({ kind: 'enter', organizationId: 'org-1' });
  });

  it('shows the chooser for a single organization when ?all=1 asked for it, staff or not', () => {
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: false, showAll: true }),
    ).toEqual({ kind: 'chooser' });
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: true, showAll: true }),
    ).toEqual({ kind: 'chooser' });
  });

  it('shows the chooser for multiple organizations, regardless of platform authority', () => {
    const organizations = [{ id: 'org-1' }, { id: 'org-2' }];
    expect(resolveOrganizationsLanding({ organizations, staff: false, showAll: false })).toEqual({
      kind: 'chooser',
    });
    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: false })).toEqual({
      kind: 'chooser',
    });
  });
});
