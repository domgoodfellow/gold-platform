import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inPlatformContext, platformAdministrationAvailable } from '@/lib/route/platform-context';

/**
 * A context switcher switches context. One identity, zero or more memberships, optional platform
 * authority, one current context — and no directory page between them.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
const switcher = read('components/containers/context-switcher.tsx');

describe('Platform Administration is offered only where it can be entered', () => {
  const gold = { id: 'gold' };

  it('needs platform authority and a GOLD Internal membership, never one alone', () => {
    expect(platformAdministrationAvailable({ staff: true, goldInternal: gold })).toBe(true);
    expect(platformAdministrationAvailable({ staff: false, goldInternal: gold })).toBe(false);
    expect(platformAdministrationAvailable({ staff: true, goldInternal: null })).toBe(false);
    expect(platformAdministrationAvailable({ staff: false, goldInternal: undefined })).toBe(false);
  });

  it('reads the Platform context from the path, exactly as a business is read', () => {
    expect(inPlatformContext('/platform')).toBe(true);
    expect(inPlatformContext('/platform/organizations/x')).toBe(true);
    expect(inPlatformContext('/platformer')).toBe(false);
    expect(inPlatformContext('/organizations/x/today')).toBe(false);
  });
});

describe('the switcher', () => {
  it('links straight to a business home and to /platform, and never through /organizations', () => {
    expect(switcher).toContain('organizationHomeHref(organization.id, organization.operationalState)');
    expect(switcher).toContain('href="/platform"');
    expect(switcher).not.toMatch(/\/organizations\?|All businesses|all=1/);
  });

  it('keeps Platform apart from the businesses, and is the list of where else, never the current context', () => {
    expect(switcher).toContain('platform ? (');
    expect(switcher).toContain('organization.id !== current.organizationId');
    // Inside Platform the shell is GOLD's, so GOLD must be listed to get back to it.
    expect(switcher).toContain('current.kind === \'business\' && !inPlatform');
  });

  it('is a plain label, not an empty menu, when there is nowhere else to go', () => {
    expect(switcher).toContain('!view.hasChoices');
    expect(switcher).toContain('hasChoices: businesses.length > 0 || platform');
  });

  it('every shell hands it the platform fact, the two layouts that host Platform from server facts', () => {
    expect(read('app/organizations/[organizationId]/layout.tsx')).toContain('platformAdministrationAvailable({ staff, goldInternal })');
    // Personal settings and the fallback frame both take it from the one person-context read.
    expect(read('lib/route/person-context.ts')).toContain('platformAdministrationAvailable({ staff, goldInternal })');
    expect(read('features/account/personal-settings-shell.tsx')).toContain('loadPersonContext()');
    expect(read('features/account/global-fallback-shell.tsx')).toContain('loadPersonContext()');
    expect(read('app/(platform)/platform/layout.tsx')).toMatch(/platformAdministration\s/);
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
