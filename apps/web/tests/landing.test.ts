import { describe, expect, it } from 'vitest';
import { resolveOrganizationsLanding } from '@/lib/route/landing';

/**
 * The locked product decision: platform staff default into Platform Administration, regardless
 * of how many businesses they also belong to. Organization membership is never taken away by
 * this — a staff member can still open, work inside, and hold real capabilities in any business
 * they are a member of — only no longer auto-entered into one by default. `?all=1` (the
 * switcher's own "All businesses" link) is the one explicit override, and it always shows the
 * chooser rather than guessing which context was meant.
 *
 * This is itself an amendment of an earlier version of this rule, which read "platform authority
 * never overrides organization context" and auto-entered a staff member's one business exactly
 * as it would a tenant-only caller's. See `lib/route/landing.ts`'s own doc comment for why that
 * turned out to be the wrong default. This file replaces the test matrix that encoded the old
 * decision — it no longer proves the old behavior anywhere.
 */
describe('resolveOrganizationsLanding — platform staff', () => {
  it('sends staff with zero organizations to /platform', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
  });

  it('sends staff with exactly one organization to /platform, not into that organization', () => {
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: true, showAll: false }),
    ).toEqual({ kind: 'platform' });
  });

  it('sends staff with several organizations to /platform', () => {
    const organizations = [{ id: 'org-1' }, { id: 'org-2' }];
    expect(resolveOrganizationsLanding({ organizations, staff: true, showAll: false })).toEqual({
      kind: 'platform',
    });
  });

  it('shows the chooser when staff explicitly ask for it via ?all=1, whatever their membership count', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: true, showAll: true })).toEqual({
      kind: 'onboarding',
    });
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: true, showAll: true }),
    ).toEqual({ kind: 'chooser' });
    expect(
      resolveOrganizationsLanding({
        organizations: [{ id: 'org-1' }, { id: 'org-2' }],
        staff: true,
        showAll: true,
      }),
    ).toEqual({ kind: 'chooser' });
  });
});

describe('resolveOrganizationsLanding — non-staff', () => {
  it('sends a caller with no organizations to onboarding', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: false, showAll: false })).toEqual({
      kind: 'onboarding',
    });
  });

  it('enters the one organization a caller belongs to', () => {
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: false, showAll: false }),
    ).toEqual({ kind: 'enter', organizationId: 'org-1' });
  });

  it('shows the chooser for several organizations', () => {
    const organizations = [{ id: 'org-1' }, { id: 'org-2' }];
    expect(resolveOrganizationsLanding({ organizations, staff: false, showAll: false })).toEqual({
      kind: 'chooser',
    });
  });

  it('shows the chooser for one organization when ?all=1 asked for it explicitly', () => {
    expect(
      resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: false, showAll: true }),
    ).toEqual({ kind: 'chooser' });
  });
});
