import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ORG = `${WEB}/app/organizations/[organizationId]`;

describe('GOLD Internal operating context composition', () => {
  const helper = readFileSync(`${WEB}/lib/domain/tenancy/gold-internal.ts`, 'utf8');
  const layout = readFileSync(`${ORG}/layout.tsx`, 'utf8');
  const shell = readFileSync(`${ORG}/org-shell.tsx`, 'utf8');

  it('identifies only current base-plan assignments for actual memberships, never a business name', () => {
    expect(helper).toContain('currentPlanAssignment');
    expect(helper).toContain("plan?.key === 'gold_internal'");
    expect(helper).not.toContain('organization.name');
    expect(helper).toContain('multiple_organizations');
  });

  it('resolves GOLD only from the caller membership list and the gold_internal plan key', () => {
    expect(helper).toContain('findGoldInternalOrganization');
    expect(helper).toContain('for (const organization of organizations)');
    expect(helper).toContain("plan?.key === 'gold_internal'");
    expect(helper).not.toContain("organization.name === 'GOLD'");
  });

  it('offers Platform Administration through the switcher only — never as navigation inside GOLD', () => {
    expect(layout).toContain('platformAdministrationAvailable({ staff, goldInternal })');
    expect(layout).toContain('platformAdministration={platformAdministration}');
    expect(shell).not.toMatch(/PLATFORM_NAV|PlatformPhoneNavMenu|GoldPlatformNav|isGoldInternal|platformStaff/);
    expect(layout).not.toMatch(/isGoldInternal|platformStaff=/);
  });

  it('gives Platform Administration its own sidebar and phone bar, reading the one PLATFORM_NAV registry', () => {
    const platformLayout = readFileSync(`${WEB}/app/(platform)/platform/layout.tsx`, 'utf8');
    const nav = readFileSync(`${WEB}/features/platform/platform-navigation.tsx`, 'utf8');
    expect(platformLayout).toContain('PlatformSidebar');
    expect(platformLayout).toContain('PlatformNavBar');
    expect(platformLayout).not.toMatch(/OrgSidebar|OrgNavBar|AREAS/);
    expect(nav).toContain('export function PlatformSidebar');
    expect(nav).toContain('export function PlatformNavBar');
    // The way back into GOLD or any other business is the switcher, present at every width.
    expect(nav).toContain('<ContextSwitcher');
  });
});
