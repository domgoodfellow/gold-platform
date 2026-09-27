import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveSwitcherView } from '@/components/containers/context-switcher';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { platformHref, platformSubpath } from '@/lib/platform-navigation';
import { inPlatformScope } from '@/lib/shell';

/**
 * A context switcher switches organization. One identity, zero or more memberships, one current
 * context — and no directory page between them. Platform is not an organization and is not a
 * destination here: platform tools are a section of GOLD's own shell, projected from the person's
 * platform permissions (`lib/shell.ts`).
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const switcher = read('components/containers/context-switcher.tsx');

const GOLD = '11111111-1111-4111-8111-111111111111';

describe('the Platform sub-scope', () => {
  it('is a path beneath GOLD’s own organization, read from the path exactly as a business is read', () => {
    expect(organizationIdFromPath(platformHref(GOLD, 'providers'))).toBe(GOLD);
    expect(platformSubpath(platformHref(GOLD))).toBe('');
    expect(platformSubpath(platformHref(GOLD, 'catalog/plans/base'))).toBe('catalog/plans/base');
    expect(platformSubpath(`${platformHref(GOLD, 'providers')}?tab=accounts`)).toBe('providers');
    expect(inPlatformScope(platformHref(GOLD, 'organizations'))).toBe(true);
  });

  it('is not the old /platform namespace, nor anything that merely resembles it', () => {
    expect(inPlatformScope('/platform')).toBe(false);
    expect(inPlatformScope('/platform/providers')).toBe(false);
    expect(inPlatformScope(`/organizations/${GOLD}/home`)).toBe(false);
    expect(inPlatformScope(`/organizations/${GOLD}/platformer`)).toBe(false);
    expect(inPlatformScope(`/organizations/not-an-id/platform`)).toBe(false);
  });
});

describe('the switcher', () => {
  it('links straight to a business home, never through /organizations, and offers no Platform destination', () => {
    expect(switcher).toContain('organizationHomeHref(organization.id, organization.operationalState)');
    expect(switcher).not.toMatch(/\/organizations\?|All businesses|all=1/);
    const executable = switcher.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(executable).not.toContain('/platform');
    expect(executable).not.toMatch(/Platform Administration|platformAdministration|inPlatformContext|Global tools/);
    // The current context is the organization the shell was built for, never something read off the path.
    expect(executable).not.toMatch(/usePathname|inPlatformScope|platformSubpath/);
  });

  it('answers which business only — Settings, Personal settings and Sign out are the account menu\'s job', () => {
    const executable = switcher.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(executable).not.toMatch(/Organization settings|Personal settings|Sign out|signOutAction/);
  });

  it('is the list of where else, never the current context', () => {
    expect(switcher).toContain('organization.id !== current.organizationId');
  });

  it('is a plain label, not an empty menu, when there is nowhere else to go', () => {
    expect(switcher).toContain('!view.hasChoices');
    expect(switcher).toContain('hasChoices: businesses.length > 0');
  });

  it('no shell hands it a platform fact: the one shell projects platform tools itself', () => {
    const shell = read('features/shell/organization-shell.tsx');
    expect(shell).not.toMatch(/platformAdministration/);
    expect(read('lib/route/person-context.ts')).not.toMatch(/platformAdministration/);
    expect(read('features/account/personal-settings-shell.tsx')).toContain('loadPersonContext()');
    expect(read('features/account/global-fallback-shell.tsx')).toContain('loadPersonContext()');
    // One shell, drawn once by the organization layout. Platform is beneath it and draws no frame of its own.
    expect(read('app/organizations/[organizationId]/layout.tsx')).toContain('<OrganizationShell');
    expect(read('app/organizations/[organizationId]/platform/layout.tsx')).not.toMatch(/OrganizationShell|<Sidebar|WorkspaceShell/);
  });
});

describe('/organizations is a landing and an onboarding page, not a directory', () => {
  it('no source links to the retired ?all=1', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !path.includes('/tests/') && /organizations\?all=1|all=1/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path.slice(WEB.length));
        }
      }
    };
    for (const root of ['app', 'components', 'features', 'lib']) walk(`${WEB}/${root}`);
    expect(offenders).toEqual([]);
  });

  it('the page lists no Platform entry and asks for no showAll', () => {
    const page = read('app/organizations/page.tsx');
    expect(page).not.toMatch(/showAll|searchParams|Global tools|Open Platform/);
    expect(read('lib/route/landing.ts')).not.toContain('showAll');
  });
});

describe('the last business is remembered, and only as a hint', () => {
  it('the proxy records it when an organization path is visited, and holds nothing but the id', () => {
    const proxy = read('proxy.ts');
    expect(proxy).toContain('organizationIdFromPath(pathname)');
    expect(proxy).toContain('response.cookies.set(LAST_ORGANIZATION_COOKIE, organizationId');
    expect(read('lib/route/last-organization.ts')).not.toContain('next/headers');
  });

  it('landing validates it against memberships rather than reading a destination from it', () => {
    const landing = read('lib/route/landing.ts');
    expect(landing).toContain('organizations.find((org) => org.id === lastOrganizationId)');
    expect(landing).not.toContain("kind: 'chooser'");
  });
});

describe('moving between organizations', () => {
  const gold = { id: 'gold', name: 'GOLD', role: 'Owner', operationalState: 'live' as const };
  const nextfund = { id: 'nf', name: 'NextFund', role: 'Owner', operationalState: 'live' as const };
  const current = { kind: 'business' as const, organizationId: 'gold', name: 'GOLD', role: 'Owner' };

  it('offers the other businesses, never the current one', () => {
    const view = deriveSwitcherView(current, [gold, nextfund]);
    expect(view.triggerName).toBe('GOLD');
    expect(view.businesses.map((org) => org.id)).toEqual(['nf']);
    expect(view).not.toHaveProperty('platform');
  });

  it('stays GOLD while an operator works in the platform namespace, because /platform renders inside GOLD', () => {
    // The switcher takes no pathname: the current context is the organization the shell was built for.
    const view = deriveSwitcherView(current, [gold, nextfund]);
    expect(view.triggerName).toBe('GOLD');
    expect(view.businesses.map((org) => org.id)).toEqual(['nf']);
  });

  it('has nowhere to go for a person with one organization', () => {
    expect(deriveSwitcherView(current, [gold]).hasChoices).toBe(false);
  });
});
