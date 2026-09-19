import { describe, expect, it } from 'vitest';
import { destinationFor, resolveOrganizationsLanding } from '@/lib/route/landing';

describe('resolveOrganizationsLanding — GOLD Internal is the preferred staff workspace', () => {
  const gold = { id: 'gold-org', operationalState: 'live' as const };

  it('enters a real GOLD Internal membership ahead of Platform, regardless of other memberships', () => {
    for (const organizations of [[gold], [gold, { id: 'customer-org', operationalState: 'live' as const }], [{ id: 'customer-org', operationalState: 'live' as const }, gold]]) {
      expect(
        resolveOrganizationsLanding({
          organizations,
          staff: true,
          preferredOrganizationId: gold.id,
          showAll: false,
        }),
      ).toEqual({ kind: 'enter', organizationId: gold.id, operationalState: 'live' });
    }
  });

  it('keeps the chooser when staff explicitly ask for all businesses', () => {
    expect(
      resolveOrganizationsLanding({
        organizations: [gold, { id: 'customer-org', operationalState: 'live' as const }],
        staff: true,
        preferredOrganizationId: gold.id,
        showAll: true,
      }),
    ).toEqual({ kind: 'chooser' });
  });
});

describe('resolveOrganizationsLanding — staff without GOLD Internal membership', () => {
  it('continues to land in Platform regardless of ordinary membership count', () => {
    for (const organizations of [[], [{ id: 'customer-org', operationalState: 'live' as const }], [{ id: 'one', operationalState: 'live' as const }, { id: 'two', operationalState: 'live' as const }]]) {
      expect(
        resolveOrganizationsLanding({ organizations, staff: true, preferredOrganizationId: null, showAll: false }),
      ).toEqual({ kind: 'platform' });
    }
  });
});

describe('resolveOrganizationsLanding — tenant-only callers', () => {
  it('preserves zero, one and many organization behavior', () => {
    expect(resolveOrganizationsLanding({ organizations: [], staff: false, showAll: false })).toEqual({ kind: 'onboarding' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'org-1', operationalState: 'live' as const }], staff: false, showAll: false })).toEqual({ kind: 'enter', organizationId: 'org-1', operationalState: 'live' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'one', operationalState: 'live' as const }, { id: 'two', operationalState: 'live' as const }], staff: false, showAll: false })).toEqual({ kind: 'chooser' });
  });
});

describe('the one organization-entry decision — SETUP enters Setup, LIVE enters Today', () => {
  const one = (operationalState: 'setup' | 'live') => ({
    organizations: [{ id: 'org-1', operationalState }],
    staff: false,
    showAll: false,
  });

  it('sends a business still in SETUP to Setup', () => {
    const landing = resolveOrganizationsLanding(one('setup'));
    expect(landing).toEqual({ kind: 'enter', organizationId: 'org-1', operationalState: 'setup' });
    expect(destinationFor(landing)).toBe('/organizations/org-1/setup');
  });

  it('sends a LIVE business to Today', () => {
    expect(destinationFor(resolveOrganizationsLanding(one('live')))).toBe('/organizations/org-1/today');
  });

  it('follows the preferred workspace’s own state, not the first business listed', () => {
    const landing = resolveOrganizationsLanding({
      organizations: [
        { id: 'other', operationalState: 'live' },
        { id: 'gold-org', operationalState: 'setup' },
      ],
      staff: true,
      preferredOrganizationId: 'gold-org',
      showAll: false,
    });
    expect(destinationFor(landing)).toBe('/organizations/gold-org/setup');
  });
});
