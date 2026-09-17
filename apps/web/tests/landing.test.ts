import { describe, expect, it } from 'vitest';
import { resolveOrganizationsLanding } from '@/lib/route/landing';

describe('resolveOrganizationsLanding — GOLD Internal is the preferred staff workspace', () => {
  const gold = { id: 'gold-org' };

  it('enters a real GOLD Internal membership ahead of Platform, regardless of other memberships', () => {
    for (const organizations of [[gold], [gold, { id: 'customer-org' }], [{ id: 'customer-org' }, gold]]) {
      expect(
        resolveOrganizationsLanding({
          organizations,
          staff: true,
          preferredOrganizationId: gold.id,
          showAll: false,
        }),
      ).toEqual({ kind: 'enter', organizationId: gold.id });
    }
  });

  it('keeps the chooser when staff explicitly ask for all businesses', () => {
    expect(
      resolveOrganizationsLanding({
        organizations: [gold, { id: 'customer-org' }],
        staff: true,
        preferredOrganizationId: gold.id,
        showAll: true,
      }),
    ).toEqual({ kind: 'chooser' });
  });
});

describe('resolveOrganizationsLanding — staff without GOLD Internal membership', () => {
  it('continues to land in Platform regardless of ordinary membership count', () => {
    for (const organizations of [[], [{ id: 'customer-org' }], [{ id: 'one' }, { id: 'two' }]]) {
      expect(
        resolveOrganizationsLanding({ organizations, staff: true, preferredOrganizationId: null, showAll: false }),
      ).toEqual({ kind: 'platform' });
    }
  });
});

describe('resolveOrganizationsLanding — tenant-only callers', () => {
  it('preserves zero, one and many organization behavior', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: false, showAll: false })).toEqual({ kind: 'onboarding' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'org-1' }], staff: false, showAll: false })).toEqual({ kind: 'enter', organizationId: 'org-1' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'one' }, { id: 'two' }], staff: false, showAll: false })).toEqual({ kind: 'chooser' });
  });
});
