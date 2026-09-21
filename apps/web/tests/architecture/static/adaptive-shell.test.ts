import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLATFORM_DESTINATIONS, platformRouteRequires } from '@/lib/platform-navigation';

/**
 * One adaptive shell. The projection decides what is *shown*; these guards hold the rest of the
 * claim: that hiding is never the boundary (every route still refuses for itself), that no renderer
 * or shared piece quietly grows an authorization rule of its own, and that Platform data stays
 * platform-scoped whichever frame draws it.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('hiding a navigation item is never the security boundary', () => {
  it('every platform area refuses, on the server, a person whose staff row does not name it', () => {
    // One layout per area, calling the guard with the permission the registry assigns that path.
    const segments = [...new Set(PLATFORM_DESTINATIONS.map((destination) => destination.href.split('/')[2]).filter(Boolean))];
    expect(segments.sort()).toEqual(['billing', 'catalog', 'failures', 'integrations', 'organizations', 'pricing', 'providers']);
    for (const segment of segments) {
      const layout = `app/(platform)/platform/${segment}/layout.tsx`;
      expect(existsSync(`${WEB}/${layout}`), `${segment} has no guard layout`).toBe(true);
      expect(read(layout), layout).toContain(`requirePlatformArea('${platformRouteRequires(`/platform/${segment}`)}')`);
    }
  });

  it('the front door sends a limited operator to the first place they may go, not to a 404', () => {
    expect(read('app/(platform)/platform/page.tsx')).toContain("requirePlatformArea('platform.health', { landing: true })");
    const guard = read('lib/route/platform.ts');
    expect(guard).toContain('notFound()');
    expect(guard).toContain('platformDestinationsFor(permissions)[0]');
  });

  it('the platform layout requires a live platform row and never trusts a claim or the URL', () => {
    const layout = code(read('app/(platform)/platform/layout.tsx'));
    expect(layout).toContain('platformPermissions(db)');
    expect(layout).not.toMatch(/user_metadata|app_metadata|jwt|role\s*===/);
  });

  it('every organization page still calls requireOrganization for itself — a layout is never the guard', () => {
    const root = `${WEB}/app/organizations/[organizationId]`;
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (entry.name === 'page.tsx') pages.push(`${dir}/${entry.name}`);
      }
    };
    walk(root);
    const unguarded = pages.filter((page) => {
      const source = readFileSync(page, 'utf8');
      // A page may delegate to a guard, redirect, or answer notFound(); what it may not do is read data unguarded.
      return !/require(Organization|OrganizationForBillingRecovery)\(|redirect\(|notFound\(\)/.test(source);
    });
    expect(unguarded.map((page) => page.slice(WEB.length))).toEqual([]);
  });
});

describe('the projection is the only eligibility rule', () => {
  const projection = code(read('lib/shell.ts'));
  const shell = code(read('features/shell/organization-shell.tsx'));
  const renderers = code(read('app/organizations/[organizationId]/org-shell.tsx'));
  const more = code(read('components/containers/more-menu.tsx'));

  it('is called once, by the shell, and its result is handed to every renderer', () => {
    expect(shell.match(/projectShell\(/g)).toHaveLength(1);
    expect(shell).toContain('sections={sections}');
    expect(shell).toMatch(/<OrgNavBar[^>]*sections=\{sections\}/);
  });

  it('no renderer or shared menu names a capability, an entitlement or a platform permission', () => {
    for (const [name, source] of [['org-shell', renderers], ['more-menu', more]] as const) {
      expect(source, name).not.toMatch(/capabilit|enabledModules|featureAvailability|platformPermissions|areaEntitled|areaVisibleTo/);
      expect(source, name).not.toMatch(/isOwner|isAdmin|isGold|isPlatformStaff|role\s*===/);
    }
  });

  it('branches on no role name anywhere in the projection or the shell', () => {
    for (const source of [projection, shell]) {
      expect(source).not.toMatch(/\.role\s*(===|!==)|role\s*(===|!==)\s*['"]/);
      expect(source).not.toMatch(/['"](Owner|Admin|Administrator|Sales|Technician)['"]/);
    }
  });

  it('gives Platform to the shell only where the organization is GOLD’s own and the person is staff', () => {
    expect(shell).toContain('staff && gold ? await platformPermissions(db) : null');
  });

  it('draws every section from the same list on desktop, tablet and phone', () => {
    expect(renderers).toContain('export function OrgNav({ sections }');
    expect(renderers).toContain('projectPhone(sections)');
    expect(renderers).toContain('<MoreMenu');
  });
});

describe('Setup is kernel and drafting is an optional accelerator inside it', () => {
  it('reaches Setup without the drafting module', () => {
    const navigation = read('lib/navigation.ts');
    const setupRow = navigation.split('\n').find((line) => line.includes("segment: 'setup'")) ?? '';
    expect(setupRow).not.toMatch(/module:|featureKeys|relevantCapabilities/);
    expect(navigation).toContain("outside: 'the Agent-assisted drafting section of Setup'");
  });

  it('keeps the drafting workflow, drawn inside Setup only when its module is on', () => {
    const page = read('app/organizations/[organizationId]/setup/page.tsx');
    expect(page).toContain("usableModules.has('drafting')");
    expect(page).toContain('{draftingOn ? (');
    // The lifecycle above it — readiness, areas, launch — is not inside that condition.
    expect(page.indexOf('<SetupAreaList')).toBeLessThan(page.indexOf('{draftingOn ? ('));
  });
});

describe('roles are editable bundles with optional templates', () => {
  it('a preset only fills the checklist; the saved role records nothing about it', () => {
    const fields = read('app/organizations/[organizationId]/roles/role-editor-fields.tsx');
    expect(fields).toContain('ROLE_PRESETS');
    expect(fields).not.toMatch(/name="preset"|name="presetKey"/);
    const domain = read('lib/domain/tenancy/roles.ts');
    expect(domain).not.toMatch(/preset/i);
  });

  it('nothing in the application asks which preset a role came from or what a role is called', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'tests') continue;
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && /ROLE_PRESETS/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(WEB.length));
      }
    };
    for (const root of ['app', 'features', 'lib', 'components']) walk(`${WEB}/${root}`);
    expect(offenders.sort()).toEqual([
      '/app/organizations/[organizationId]/roles/role-editor-fields.tsx',
      '/lib/domain/tenancy/role-presets.ts',
    ]);
  });
});
