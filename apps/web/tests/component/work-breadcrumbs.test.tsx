// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCrumbsProvider, WorkspaceCrumbSlot, PageCrumbs } from '@/components/navigation/workspace-crumbs';
import { AREAS, areaHref, areaLabel } from '@/lib/navigation';
import { projectBusinessNavigation } from '@/lib/application/shell/business-navigation';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import type { BusinessProfile } from '@/lib/domain/tenancy/business-profile';

/**
 * Work's pages name their parent with the label the business's own navigation shows for it, and no
 * Work page claims a Configuration ancestor: Work has no Configuration row (its editors open from
 * Work items and Schedule).
 */
const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const org = '11111111-1111-4111-8111-111111111111';
const input = { organizationId: org, enabledModules: new Set(['billing', 'assets']), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES), schedulableWork: true };
const renamed: BusinessProfile = { revision: 1, navigation: [], nouns: {}, labels: { work: 'Jobs', schedule: 'Diary' } };

// What each Work page authors as its ancestor (the same registry label and address its page passes).
const PAGES = [
  { path: 'work/new', current: 'New work', parent: 'work' },
  { path: 'work/configuration', current: 'Work configuration', parent: 'work' },
  { path: 'schedule/configuration', current: 'Schedule configuration', parent: 'schedule' },
] as const;

function crumbsAt(path: string, parent: string, current: string, profile: BusinessProfile | null) {
  route.pathname = `/organizations/${org}/${path}`;
  render(<WorkspaceCrumbsProvider navigation={{ organizationId: org, sections: projectBusinessNavigation(input, profile) }}><WorkspaceCrumbSlot /><PageCrumbs crumbs={[{ label: areaLabel(parent), href: areaHref(org, parent) }]} current={current} /></WorkspaceCrumbsProvider>);
  return screen.getAllByRole('navigation').find((element) => element.getAttribute('aria-label') === 'breadcrumb')!;
}

describe('Work breadcrumbs', () => {
  it.each(PAGES)('$path names its parent with the default label and no Configuration ancestor', ({ path, current, parent }) => {
    const trail = crumbsAt(path, parent, current, null);
    const link = trail.querySelector(`a[href="${areaHref(org, parent)}"]`);
    expect(link).toHaveTextContent(areaLabel(parent));
    // The current page may say "configuration" in lower case; no ancestor is a capitalised Configuration level.
    expect(trail.textContent).not.toMatch(/Configuration/);
  });

  it.each(PAGES)('$path names its parent with the business’s renamed label', ({ path, current, parent }) => {
    const trail = crumbsAt(path, parent, current, renamed);
    const link = trail.querySelector(`a[href="${areaHref(org, parent)}"]`);
    expect(link?.textContent?.trim()).toBe(parent === 'work' ? 'Jobs' : 'Diary');
  });

  it('New work takes its parent label from the registry, never a hardcoded word', () => {
    const page = readFileSync(path.join(process.cwd(), 'app/organizations/[organizationId]/work/new/page.tsx'), 'utf8');
    expect(page).toContain("label: areaLabel('work'), href: areaHref(organizationId, 'work')");
    expect(page).not.toContain("'Work Items'");
  });
});
