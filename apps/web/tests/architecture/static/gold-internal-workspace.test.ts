import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ORG = `${WEB}/app/organizations/[organizationId]`;
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

describe('GOLD Internal operating context composition', () => {
  const helper = read('lib/domain/tenancy/gold-internal.ts');
  const shell = read('features/shell/organization-shell.tsx');
  const renderers = readFileSync(`${ORG}/org-shell.tsx`, 'utf8');

  it('identifies only current base-plan assignments for actual memberships, never a business name', () => {
    expect(helper).toContain('currentPlanAssignment');
    expect(helper).toContain("plan?.key === 'gold_internal'");
    expect(helper).not.toContain('organization.name');
    expect(helper).toContain('multiple_organizations');
  });

  it('resolves GOLD only from the caller membership list and the gold_internal plan key', () => {
    expect(helper).toContain('findGoldInternalOrganization');
    expect(helper).toContain('for (const organization of organizations)');
    expect(helper).not.toContain("organization.name === 'GOLD'");
  });

  it('asks of the organization being drawn whether it is GOLD, by plan, never by the person', () => {
    expect(helper).toContain('export async function isGoldInternalOrganization');
    expect(shell).toContain('isGoldInternalOrganization(db, { organizationId })');
    // Platform permissions are read only when both are true, and are null everywhere else.
    expect(shell).toContain('staff && gold ? await platformPermissions(db) : null');
  });

  it('renders Platform beneath the one organization shell — no second shell exists', () => {
    // The organization layout draws the shell; the Platform layout beneath it is only the door.
    expect(read('app/organizations/[organizationId]/layout.tsx')).toContain('<OrganizationShell');
    const platformLayout = read('app/organizations/[organizationId]/platform/layout.tsx');
    expect(platformLayout).not.toMatch(/OrganizationShell|PlatformSidebar|PlatformNavBar|WorkspaceShell/);
    expect(() => read('features/platform/platform-navigation.tsx')).toThrow();
    expect(() => read('app/(platform)/platform/layout.tsx')).toThrow();
  });

  it('draws Platform only from the projection: no renderer branches on who somebody is', () => {
    expect(renderers).not.toMatch(/PLATFORM_NAV|PlatformPhoneNavMenu|GoldPlatformNav|isGoldInternal|platformStaff|isPlatformStaff|isOwner|isAdmin/);
    expect(shell).not.toMatch(/isOwner|isAdmin|role ===|role !==/);
    const projection = read('lib/shell.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(projection).not.toMatch(/\.role\b|isOwner|isAdmin|isGold\b|isPlatformStaff|Owner|Admin['"]/);
  });
});
