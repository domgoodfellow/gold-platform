import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLATFORM_DESTINATIONS } from '@/lib/platform-navigation';
import { platformHref } from '@/lib/platform-navigation';
import { inPlatformScope } from '@/lib/shell';

/**
 * Fallback frames and Platform context navigation. Source guards, like the other shell suites —
 * nothing here mounts a component. The rendered result was checked in a browser at desktop and
 * phone widths. These pin the *rules*: who owns which failure, what a fallback may know, and the
 * order the phone bar takes in each context.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const exists = (path: string) => existsSync(`${WEB}/${path}`);

const walk = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, files);
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
};

describe('the retired directory is gone from every fallback', () => {
  it('no source-visible "Your businesses" remains', () => {
    const offenders = ['app', 'components', 'features', 'lib']
      .flatMap((root) => walk(`${WEB}/${root}`))
      .filter((path) => /Your businesses/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });

  it('names its recovery for what it does, never as a list of businesses', () => {
    const shell = read('features/account/global-fallback-shell.tsx');
    expect(shell).toContain("'Return to workspace'");
    expect(shell).toContain("'Set up your business'");
    expect(code(read('components/containers/organization-not-found.tsx'))).toContain('Return to workspace');
  });
});

describe('an organization that cannot be proven is never described', () => {
  const unavailable = read('components/containers/organization-not-found.tsx');
  const shell = read('features/account/global-fallback-shell.tsx');
  const sidebar = read('features/account/global-fallback-sidebar.tsx');

  it('the fallback frame is built from the person’s own context alone — it never receives the requested id', () => {
    expect(shell).toContain('loadPersonContext()');
    expect(code(shell)).not.toMatch(/organizationId|params|requireOrganization|getOrganization\(/);
    expect(code(unavailable)).not.toMatch(/organizationId|params|requireOrganization|getOrganization\(/);
    expect(code(read('app/organizations/not-found.tsx'))).not.toMatch(/params|organizationId/);
  });

  it('the sidebar holds the switcher and the account menu and no organization navigation', () => {
    expect(sidebar).toContain("current={{ kind: 'global' }}");
    expect(sidebar).not.toMatch(/OrgNav|AREAS|areasIn\(|PLATFORM_NAV|organizationHomeHref/);
  });

  it('the copy does not confirm the organization exists, and “missing” and “not yours” read the same', () => {
    expect(unavailable).toContain('This business is not available');
    expect(unavailable).toContain('may not be one you belong to');
    const frame = unavailable.slice(unavailable.indexOf('export function OrganizationUnavailable'), unavailable.indexOf('export function OrganizationPageNotFound'));
    expect(frame).not.toMatch(/does not exist|no longer exist|deleted|wrong organization/i);
    // One answer for both: the guard's own comment, and one shared component behind it.
    expect(read('lib/route/organization.ts')).toContain('indistinguishably');
  });

  it('recovery is the validated landing a sign-in uses, read-only, with nothing hard-coded', () => {
    expect(shell).toContain('resolveOrganizationsLanding');
    expect(shell).toContain('destinationFor(landing)');
    expect(code(shell)).not.toMatch(/consumePendingInvite|resolvePostAuthDestination/);
    expect(code(shell)).not.toMatch(/href:\s*['"`]\/platform|gold_internal|organizations\[0\]/);
  });

  it('the person-context read is itself session-guarded', () => {
    const person = read('lib/route/person-context.ts');
    expect(person).toContain('requireActor(db)');
    expect(person).toContain("redirect('/login')");
  });
});

describe('who owns which failure', () => {
  it('a non-member is caught by the ancestor boundary and gets the safe frame', () => {
    expect(read('app/organizations/not-found.tsx')).toContain('OrganizationUnavailable');
    expect(read('features/shell/organization-shell.tsx')).toContain('requireOrganizationForBillingRecovery(');
  });

  it('a missing child beneath a proven membership renders inside the organization layout', () => {
    expect(read('app/organizations/[organizationId]/not-found.tsx')).toContain('OrganizationPageNotFound');
    const page = read('app/organizations/[organizationId]/[...unmatched]/page.tsx');
    expect(page).toContain('await requireOrganization(organizationId)');
    expect(page).toContain('notFound()');
    // The in-shell fallback draws no chrome of its own.
    expect(code(read('components/containers/fallback-page.tsx'))).not.toMatch(/Sidebar|WorkspaceShell|WorkspaceHeader|<main/);
  });

  it('Platform keeps Platform context: a catch-all and a boundary inside its layout segment', () => {
    expect(exists('app/organizations/[organizationId]/platform/[...unmatched]/page.tsx')).toBe(true);
    const boundary = read('app/organizations/[organizationId]/platform/not-found.tsx');
    expect(boundary).toContain('FallbackPage');
    expect(boundary).toContain('platformHref(');
    expect(code(boundary)).not.toMatch(/SiteShell|WorkspaceShell/);
  });

  it('Personal settings renders its own shell, since no layout above it draws one', () => {
    expect(exists('app/settings/[[...unmatched]]/page.tsx')).toBe(true);
    expect(read('app/settings/not-found.tsx')).toContain('PersonalSettingsShell');
  });

  it('public routes keep the public 404, and the root boundary is still the marketing one', () => {
    expect(read('app/not-found.tsx')).toContain('SiteShell');
    expect(read('app/(public)/not-found.tsx')).not.toMatch(/SiteShell|Sidebar|WorkspaceShell/);
    // The authenticated fallbacks never borrow it.
    for (const file of [
      'app/organizations/not-found.tsx',
      'app/organizations/[organizationId]/not-found.tsx',
      'app/organizations/[organizationId]/platform/not-found.tsx',
      'app/settings/not-found.tsx',
      'components/containers/organization-not-found.tsx',
    ]) {
      expect(read(file), file).not.toContain('SiteShell');
    }
  });

  it('every catch-all only throws notFound() — it never renders content or reads data of its own', () => {
    for (const file of [
      'app/organizations/[organizationId]/[...unmatched]/page.tsx',
      'app/organizations/[organizationId]/platform/[...unmatched]/page.tsx',
      'app/settings/[[...unmatched]]/page.tsx',
    ]) {
      const source = code(read(file));
      expect(source, file).toMatch(/notFound\(\);\s*}\s*$/);
      expect(source, file).not.toMatch(/<[A-Z]|return\s*\(/);
    }
  });
});

describe('the phone bar is one projection with a More menu', () => {
  const shell = read('app/organizations/[organizationId]/org-shell.tsx');
  const bar = shell.slice(shell.indexOf('export function OrgNavBar('), shell.indexOf('export function SetupEntry'));

  it('a business’s bar renders the projection it is given — it decides no eligibility of its own', () => {
    expect(bar).toContain('projectPhone(sections, { platformActive })');
    expect(bar).not.toMatch(/visibleAreas\(|areasIn\(|PlatformPhoneNavMenu|PLATFORM_NAV|inPlatformContext|capabilit/);
  });

  it('reaches Administration and Platform behind More rather than crowding the bar', () => {
    expect(bar).toContain('More');
    expect(bar).toContain('<MoreMenu');
  });

  it('Platform is offered only from server-resolved facts, inside the one shell', () => {
    const org = read('features/shell/organization-shell.tsx');
    expect(org).toContain('staff && gold ? await platformPermissions(db) : null');
    expect(org).not.toMatch(/platformStaff=|isGoldInternal=/);
  });

  it('reads the Platform sub-scope from the path: GOLD’s organization, then /platform and beneath', () => {
    const gold = '11111111-1111-4111-8111-111111111111';
    expect(inPlatformScope(platformHref(gold))).toBe(true);
    expect(inPlatformScope(platformHref(gold, 'providers'))).toBe(true);
    expect(inPlatformScope('/platform/providers')).toBe(false);
    expect(inPlatformScope(`/organizations/${gold}/platformer`)).toBe(false);
    expect(inPlatformScope(`/organizations/${gold}/home`)).toBe(false);
  });

  it('PLATFORM_DESTINATIONS is the one Platform navigation registry, declared once', () => {
    expect(PLATFORM_DESTINATIONS.length).toBeGreaterThan(3);
    const literals = walk(`${WEB}/app`).concat(walk(`${WEB}/features`), walk(`${WEB}/components`), walk(`${WEB}/lib`))
      .filter((path) => /PLATFORM_DESTINATIONS: [^=]*=\s*\[/.test(readFileSync(path, 'utf8')));
    expect(literals.map((path) => path.slice(WEB.length))).toEqual(['/lib/platform-navigation.ts']);
  });
});

describe('the mobile sidebar trigger says what the layouts do', () => {
  it('Platform Context uses navigationTrigger="md", and the header comment agrees', () => {
    // Platform renders inside the one organization shell, which asks for the trigger from md up.
    expect(read('features/shell/organization-shell.tsx')).toContain('navigationTrigger="md"');
    const header = read('components/containers/workspace-header.tsx');
    expect(header).toContain('Business *and*');
    expect(header).not.toMatch(/Platform, whose\s*\n\s*\*\s*`Sidebar` renders an off-canvas Sheet/);
  });

  it('only shells with no bottom bar ask for the trigger at every width', () => {
    expect(read('features/account/personal-settings-shell.tsx')).toContain('navigationTrigger="always"');
    expect(read('features/account/global-fallback-shell.tsx')).toContain('navigationTrigger="always"');
    expect(read('features/shell/organization-shell.tsx')).toContain('navigationTrigger="md"');
  });
});

describe('Personal settings says it once', () => {
  it('has no sidebar group label repeating the switcher, and no crumb repeating the sidebar', () => {
    const sidebar = read('features/account/personal-settings-sidebar.tsx');
    expect(code(sidebar)).not.toContain('SidebarGroupLabel');
    for (const page of ['app/settings/account/page.tsx', 'app/settings/account/security/page.tsx']) {
      expect(read(page), page).not.toContain('crumbs=');
    }
  });

  it('its sections carry icons like every other sidebar destination, presentation-only and keyed by section', () => {
    const sidebar = read('features/account/personal-settings-sidebar.tsx');
    expect(sidebar).toContain('SECTION_ICONS');
    expect(sidebar).toContain('<Icon aria-hidden />');
    expect(read('lib/route/personal-settings.ts')).not.toMatch(/lucide|Icon/);
  });
});
