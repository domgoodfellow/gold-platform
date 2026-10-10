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
    const segments = [...new Set(PLATFORM_DESTINATIONS.map((destination) => destination.path.split('/')[0]).filter(Boolean))];
    expect(segments.sort()).toEqual(['ai-runtime', 'billing', 'catalog', 'economics', 'failures', 'integrations', 'organizations', 'package-economics', 'plans', 'pricing', 'providers', 'usage', 'vendor-rates']);
    for (const segment of segments) {
      const layout = `app/organizations/[organizationId]/platform/${segment}/layout.tsx`;
      expect(existsSync(`${WEB}/${layout}`), `${segment} has no guard layout`).toBe(true);
      expect(read(layout), layout).toContain(`requirePlatformArea(organizationId, '${platformRouteRequires(segment)}')`);
    }
  });

  it('every platform page asks for its own area, with the permission the registry assigns its path', () => {
    // A layout is not re-rendered on every client navigation and renders beside its page, so the page
    // guards itself (I12) exactly as an organization page does. The catch-all only throws notFound().
    const root = `${WEB}/app/organizations/[organizationId]/platform`;
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
        else if (entry.name === 'page.tsx') pages.push(`${dir}/${entry.name}`);
      }
    };
    walk(root);
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      const subpath = page.slice(root.length + 1).replace(/\/?page\.tsx$/, '').replace('[targetOrganizationId]', 'x');
      if (subpath.startsWith('[...unmatched]')) continue;
      // Plans & Add-ons moved to Finance; these two addresses are bookmark redirects only, the
      // same pattern as the top-level legacy `/platform` route — they prove nothing themselves,
      // and the canonical Finance page is where `requirePlatformArea` actually runs.
      if (subpath === 'catalog/plans' || subpath === 'catalog/plans/[planKey]') continue;
      const cap = platformRouteRequires(subpath);
      const source = readFileSync(page, 'utf8');
      // The overview is the front door and names its own landing option; every other page is the plain call.
      expect(source, page.slice(WEB.length)).toMatch(new RegExp(`requirePlatformArea\\((goldId|organizationId), '${cap}'`));
    }
  });

  it('the front door sends a limited operator to the first place they may go, not to a 404', () => {
    expect(read('app/organizations/[organizationId]/platform/page.tsx')).toContain(
      "requirePlatformArea(goldId, 'platform.health', { landing: true })",
    );
    const guard = read('lib/route/platform.ts');
    expect(guard).toContain('notFound()');
    expect(guard).toContain('platformDestinationsFor(permissions)[0]');
  });

  it('the platform scope proves GOLD’s own organization, membership and a live platform row — never a claim or the URL alone', () => {
    const layout = code(read('app/organizations/[organizationId]/platform/layout.tsx'));
    expect(layout).toContain('requirePlatformScope(organizationId)');
    const guard = code(read('lib/route/platform.ts'));
    // The three facts, in the order a refusal is cheapest: membership, identity, authority.
    expect(guard).toContain('requireOrganizationForBillingRecovery(organizationId)');
    expect(guard).toContain('isGoldInternalOrganization(db, { organizationId })');
    expect(guard).toContain('platformPermissions(db)');
    expect(guard.indexOf('requireOrganizationForBillingRecovery(')).toBeLessThan(guard.indexOf('isGoldInternalOrganization('));
    expect(guard.indexOf('isGoldInternalOrganization(')).toBeLessThan(guard.indexOf('platformPermissions(db)'));
    expect(guard).not.toMatch(/user_metadata|app_metadata|jwt|role\s*===/);
  });

  it('the old /platform address is a redirect that owns no page and reads its target from GOLD’s Plan, not the URL', () => {
    const legacy = code(read('app/platform/[[...path]]/page.tsx'));
    expect(legacy).toContain('findGoldInternalOrganization(');
    expect(legacy).toContain('platformHref(goldInternal.id');
    expect(legacy).not.toMatch(/<[A-Z]/);
    expect(readdirSync(`${WEB}/app/platform`)).toEqual(['[[...path]]']);
    expect(existsSync(`${WEB}/app/(platform)`)).toBe(false);
  });

  it('no application source spells a /platform address by hand: the registry is the one way to write one', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'tests') continue;
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && /['"`]\/platform(['"`/?]|$)/m.test(code(readFileSync(path, 'utf8')))) offenders.push(path.slice(WEB.length));
      }
    };
    for (const root of ['app', 'features', 'lib', 'components']) walk(`${WEB}/${root}`);
    // The legacy entry and the three places that name it: the redirect itself, where staff with no
    // GOLD membership are sent, and the crawler policy that keeps the old address out of an index.
    expect(offenders.sort()).toEqual([
      '/app/organizations/page.tsx',
      '/app/platform/[[...path]]/page.tsx',
      '/app/robots.ts',
      '/lib/route/landing.ts',
    ]);
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
      return !/require(Organization|OrganizationForBillingRecovery|PlatformArea)\(|redirect\(|notFound\(\)/.test(source);
    });
    expect(unguarded.map((page) => page.slice(WEB.length))).toEqual([]);
  });
});

describe('the projection is the only eligibility rule', () => {
  const projection = code(read('lib/shell.ts'));
  const shell = code(read('features/shell/organization-shell.tsx')) + code(read('app/organizations/[organizationId]/org-shell.tsx'));
  // Phase C (Slice 12) moved the shell's own coordinating reads — `projectShell` among them —
  // out of the layout component into one application-layer function the layout calls once and
  // destructures; the layout still hands the one result to every renderer.
  const shellModel = code(read('lib/application/shell/organization-shell.ts'));
  const renderers = code(read('app/organizations/[organizationId]/org-shell.tsx'));

  it('is called once, by the shell, and its result is handed to every renderer', () => {
    expect(shellModel.match(/projectShell\(/g)).toHaveLength(1);
    expect(shell).toContain('sections={sections}');
    expect(shell).toMatch(/<OrgNavBar[^>]*sections=\{sections\}/);
  });

  it('no renderer names a capability, an entitlement or a platform permission', () => {
    for (const [name, source] of [['org-shell', renderers]] as const) {
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
    expect(shellModel).toContain('loadPlatformContext(db, myOrganizations)');
    const platformModel = code(read('lib/application/shell/platform-context.ts'));
    expect(platformModel).toContain('platformPermissions(db)');
    expect(platformModel).toContain('permissions.size === 0');
    expect(platformModel).toContain('findGoldInternalOrganization(db, organizations)');
  });

  it('draws every section from the same list on desktop, tablet and phone', () => {
    expect(renderers).toContain('export function OrgNav({ sections }');
    // The phone Menu is the sidebar's own Sheet: the one `OrgSidebar` receives `sections` and draws `OrgNav`
    // for both breakpoints, and the phone bar carries no destination list of its own.
    expect(renderers).toContain('export function OrgNavBar({ sections }');
    expect(renderers).toContain('<OrgNav sections={sections} />');
    expect(renderers).not.toMatch(/projectPhone|MoreMenu|overflow-x/);
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
    // Drafting is drawn when the member may ask for a proposal or one already exists — never
    // because a module is on or off, since Setup itself is kernel.
    expect(page).toContain('const draftingOn = mayPropose || proposal !== null;');
    expect(page).toContain('{draftingOn ? (');
    // The lifecycle above it — readiness, steps, launch — is not inside that condition.
    expect(page.indexOf('<GuidedSetup')).toBeLessThan(page.indexOf('{draftingOn ? ('));
  });
});

describe('roles are editable bundles with optional templates', () => {
  it('a preset only fills the checklist; the saved role records nothing about it', () => {
    const fields = read('features/team/role-editor-fields.tsx');
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
      '/features/team/role-editor-fields.tsx',
      '/lib/domain/tenancy/role-presets.ts',
    ]);
  });
});
