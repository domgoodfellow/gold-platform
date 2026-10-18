import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ORG = `${WEB}/app/organizations/[organizationId]`;
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

describe('GildOps operating context composition', () => {
  const helper = read('lib/domain/platform/operating-organization.ts');
  const shell = read('features/shell/organization-shell.tsx');
  // Phase C (Slice 12) moved this read, with the rest of the shell's coordinating reads, out of
  // the layout component into one application-layer function the layout calls once.
  const shellModel = read('lib/application/shell/organization-shell.ts');
  const renderers = readFileSync(`${ORG}/org-shell.tsx`, 'utf8');

  it('reads the operating identity from platform configuration, never a Plan or a business name', () => {
    expect(helper).toContain("db.rpc('caller_operating_organization_id')");
    const code = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/currentPlanAssignment|getPlanById|gold_internal'|organization\.name|platformPermissions/);
  });

  it('has one identity resolver: the plan-based one is gone and nothing else asks a Plan who GildOps is', () => {
    expect(() => read('lib/domain/tenancy/gold-internal.ts')).toThrow();
    for (const path of [
      'lib/route/platform.ts',
      'lib/route/landing.ts',
      'lib/route/person-context.ts',
      'app/organizations/page.tsx',
      'app/platform/page.tsx',
      'lib/application/shell/platform-context.ts',
    ]) {
      expect(read(path)).not.toMatch(/findGoldInternalOrganization|isGoldInternalOrganization|gold_internal'/);
    }
  });

  it('resolves Administration for the organization being drawn, and only GildOps’ own', () => {
    expect(helper).toContain('export async function isOperatingOrganization');
    expect(shellModel).toContain('loadPlatformContext(db, organizationId)');
    const platformContext = read('lib/application/shell/platform-context.ts');
    expect(platformContext).toContain('platformPermissions(db)');
    expect(platformContext).toContain('isOperatingOrganization(db, { organizationId })');
    expect(platformContext).toContain('permissions.size === 0');
  });

  it('renders Platform beneath the one organization shell — no second shell exists', () => {
    // The organization layout draws the shell; the Platform layout beneath it is only the door.
    expect(read('app/organizations/[organizationId]/layout.tsx')).toContain('<OrganizationShell');
    const platformLayout = read('app/platform/layout.tsx');
    expect(platformLayout).not.toMatch(/OrganizationShell|PlatformSidebar|PlatformNavBar|WorkspaceShell/);
    expect(() => read('features/platform/platform-navigation.tsx')).toThrow();
    expect(() => read('app/(platform)/platform/layout.tsx')).toThrow();
  });

  it('draws Platform only from the projection: no renderer branches on who somebody is', () => {
    expect(renderers).not.toMatch(/PLATFORM_NAV|PlatformPhoneNavMenu|GoldPlatformNav|isGoldInternal|platformStaff|isPlatformStaff|isOwner|isAdmin/);
    expect(shell).not.toMatch(/isOwner|isAdmin|role ===|role !==/);
    const projection = read('lib/shell.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(projection).not.toMatch(/\.role\b|isOwner|isAdmin|isGold\b|isPlatformStaff|\bOwner\b|Admin['"]/);
  });
});
