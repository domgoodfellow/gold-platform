import { describe, expect, it } from 'vitest';
import { destinationFor, resolveOrganizationsLanding } from '@/lib/route/landing';

describe('resolveOrganizationsLanding — GildOps\' operating organization is preferred for its members', () => {
  const gold = { id: 'gold-org', operationalState: 'live' as const };

  it('enters a real membership of the operating organization ahead of any other', () => {
    for (const organizations of [[gold], [gold, { id: 'customer-org', operationalState: 'live' as const }], [{ id: 'customer-org', operationalState: 'live' as const }, gold]]) {
      expect(resolveOrganizationsLanding({ organizations, preferredOrganizationId: gold.id })).toEqual({ kind: 'enter', organizationId: gold.id, operationalState: 'live' });
    }
  });

  it('has no way to ask for a directory: the retired ?all=1 request changes nothing', () => {
    // `showAll` is gone from the input, so a stale link cannot ask for a directory, whoever follows it.
    const input = {
      organizations: [gold, { id: 'customer-org', operationalState: 'live' as const }],
      preferredOrganizationId: gold.id,
      showAll: true,
    } as Parameters<typeof resolveOrganizationsLanding>[0];
    expect(resolveOrganizationsLanding(input)).toEqual({ kind: 'enter', organizationId: gold.id, operationalState: 'live' });
  });

  it('takes no platform authority as an input: Administration is a context of GildOps\' organization, not a landing of its own', () => {
    const input = { organizations: [], staff: true } as Parameters<typeof resolveOrganizationsLanding>[0];
    expect(resolveOrganizationsLanding(input)).toEqual({ kind: 'onboarding' });
    expect(destinationFor(resolveOrganizationsLanding(input))).toBe('/organizations');
  });
});

describe('resolveOrganizationsLanding — zero, one and many memberships', () => {
  it('preserves zero, one and many organization behavior', () => {
    expect(resolveOrganizationsLanding({ organizations: [] })).toEqual({ kind: 'onboarding' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'org-1', operationalState: 'live' as const }] })).toEqual({ kind: 'enter', organizationId: 'org-1', operationalState: 'live' });
    expect(resolveOrganizationsLanding({ organizations: [{ id: 'one', operationalState: 'live' as const }, { id: 'two', operationalState: 'live' as const }] })).toEqual({ kind: 'enter', organizationId: 'one', operationalState: 'live' });
  });
});

describe('resolveOrganizationsLanding — several memberships never meet a directory', () => {
  const orgs = [
    { id: 'one', operationalState: 'live' as const },
    { id: 'two', operationalState: 'setup' as const },
    { id: 'three', operationalState: 'live' as const },
  ];

  it('enters the business last worked in, through its own lifecycle entry', () => {
    expect(resolveOrganizationsLanding({ organizations: orgs, lastOrganizationId: 'two' })).toEqual({ kind: 'enter', organizationId: 'two', operationalState: 'setup' });
  });

  it('falls back to the first membership when nothing is remembered', () => {
    expect(resolveOrganizationsLanding({ organizations: orgs })).toMatchObject({ kind: 'enter', organizationId: 'one' });
  });

  it('never trusts the remembered id: a business the caller does not belong to falls through', () => {
    expect(resolveOrganizationsLanding({ organizations: orgs, lastOrganizationId: 'somebody-elses' })).toMatchObject({ kind: 'enter', organizationId: 'one' });
  });

  it('yields to the operating organization, whatever was remembered', () => {
    expect(resolveOrganizationsLanding({ organizations: orgs, preferredOrganizationId: 'three', lastOrganizationId: 'two' })).toMatchObject({ kind: 'enter', organizationId: 'three' });
  });

  it('only a caller with no business at all is sent to /organizations, to found one', () => {
    expect(resolveOrganizationsLanding({ organizations: [] })).toEqual({ kind: 'onboarding' });
    expect(destinationFor({ kind: 'onboarding' })).toBe('/organizations');
  });
});

describe('the one organization-entry decision — every organization enters Home', () => {
  const one = (operationalState: 'setup' | 'live') => ({ organizations: [{ id: 'org-1', operationalState }] });

  it('sends a business still in SETUP to Home, where readiness is contextual', () => {
    const landing = resolveOrganizationsLanding(one('setup'));
    expect(landing).toEqual({ kind: 'enter', organizationId: 'org-1', operationalState: 'setup' });
    expect(destinationFor(landing)).toBe('/organizations/org-1/home');
  });

  it('sends a LIVE business to Home', () => {
    expect(destinationFor(resolveOrganizationsLanding(one('live')))).toBe('/organizations/org-1/home');
  });

  it('follows the preferred workspace, not the first business listed', () => {
    const landing = resolveOrganizationsLanding({
      organizations: [
        { id: 'other', operationalState: 'live' },
        { id: 'gold-org', operationalState: 'setup' },
      ],
      preferredOrganizationId: 'gold-org',
    });
    expect(destinationFor(landing)).toBe('/organizations/gold-org/home');
  });
});
