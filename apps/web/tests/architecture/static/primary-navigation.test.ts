import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Source rules for the primary navigation: Home, Search and Library are one shared group at every
 * depth, Library is a popover rather than a page of its own, and Setup is onboarding status rather
 * than a sidebar category. Read from source because the shell is a server layout around client
 * components that the component tests cover one piece at a time.
 */
const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}${path}`, 'utf8');
const ORG_SHELL = 'app/organizations/[organizationId]/org-shell.tsx';
const LIBRARY = 'app/organizations/[organizationId]/library';

describe('primary navigation', () => {
  const shell = read(ORG_SHELL);

  it('draws Home, Search and Library through one shared group, at every depth', () => {
    expect(shell).toMatch(/function PrimaryNavigation\(/);
    expect(shell.match(/<PrimaryNavigation /g)).toHaveLength(1);
    expect(shell).toContain('<SearchEntry />');
    expect(shell).toContain('<LibraryMenu');
    expect(shell).toContain('shellHomeItem(sections)');
  });

  it('removes Back to Workspaces entirely', () => {
    expect(shell).not.toContain('Back to Workspaces');
    expect(shell).not.toContain('ArrowLeft');
  });

  it('removes the shell notification bell, the global Dialer launcher and the Setup sidebar badge', () => {
    expect(shell).not.toContain('NotificationBell');
    expect(shell).not.toContain('DialerTrigger');
    expect(shell).not.toContain('setupRemaining');
    expect(read('features/shell/organization-shell.tsx')).not.toContain('Setup · ');
    expect(read('components/navigation/context-switcher.tsx')).toContain('Setup pending');
  });

  it('keeps the Settings navigation as its own context, outside the primary group', () => {
    expect(shell).toContain('<SettingsNav');
  });
});

describe('search', () => {
  const commandCenter = read('features/home/command-center.tsx');

  it('has no visible shortcut hint and no global shortcut handler', () => {
    expect(commandCenter).not.toContain('⌘K');
    expect(commandCenter).not.toMatch(/metaKey|ctrlKey/);
    expect(read('features/home/home-dashboard.tsx')).not.toContain('⌘K');
  });

  it('draws Search as a standard sidebar row, not a bespoke button', () => {
    expect(commandCenter).toMatch(/export function SearchEntry[\s\S]*<SidebarMenuButton/);
  });

  it('no longer carries the notification bell or its status dialog', () => {
    expect(commandCenter).not.toContain('NotificationBell');
    expect(commandCenter).not.toContain('Notifications');
  });
});

describe('Library', () => {
  it('redirects the root to the first destination, with no overview', () => {
    const root = read(`${LIBRARY}/page.tsx`);
    expect(root).toContain('redirect(libraryHref(organizationId, LIBRARY_DEFAULT_SECTION))');
    expect(root).not.toContain('WorkspaceHome');
    expect(root).not.toContain('NavigationList');
  });

  it('keeps every existing section route as a page', () => {
    for (const section of ['files', 'media', 'templates', 'knowledge', 'collections', 'sources', 'trash']) {
      expect(read(`${LIBRARY}/${section}/page.tsx`)).toBeTruthy();
    }
  });

  it('keeps the section tab strip on every section page, and none on the root redirect', () => {
    expect(read(`${LIBRARY}/page.tsx`)).not.toContain('LibraryNav');
    for (const page of [
      `${LIBRARY}/sources/page.tsx`,
      `${LIBRARY}/media/page.tsx`,
      `${LIBRARY}/templates/page.tsx`,
      `${LIBRARY}/knowledge/page.tsx`,
      `${LIBRARY}/collections/page.tsx`,
      `${LIBRARY}/trash/page.tsx`,
    ]) {
      const source = read(page);
      expect(source.includes('LibraryNav') || source.includes('LibrarySectionPage'), page).toBe(true);
    }
    expect(read('features/library/library-section-page.tsx')).toContain('<LibraryNav');
    expect(read('features/library/files/library-files.tsx')).toContain('<LibraryNav');
  });

  it('builds its popover from the one registry, not a second destination list', () => {
    const menu = read('features/library/library-nav.tsx');
    expect(menu).toContain('LIBRARY_SECTIONS.map');
    expect(menu).toContain('libraryHref(organizationId, section.key)');
    expect(menu).toContain('<Popover ');
    expect(menu).not.toMatch(/label: ['"](Files|Media|Templates)['"]/);
  });

  it('points its crumbs at a section, not the retired overview', () => {
    expect(read('features/library/library-section-page.tsx')).toContain("libraryHref(organizationId, 'files')");
    expect(read(`${LIBRARY}/sources/page.tsx`)).toContain("libraryHref(organizationId, 'files')");
  });
});

describe('organization Home setup', () => {
  it('computes setup only while the business is in SETUP and renders the banner there', () => {
    const home = read('app/organizations/[organizationId]/home/page.tsx');
    expect(home).toContain("organization.operationalState === 'setup'");
    expect(home).toContain('computeSetupOverview');
    expect(home).toContain('<SetupBanner');
  });
});
