/**
 * Library is one destination with several internal sections — Files, Media, Templates, Knowledge,
 * Collections, Sources and Trash — reached from Library's own popover in the sidebar rather than a
 * second permanent sidebar (`docs/ui-system.md`: Library is shared organization infrastructure, never
 * a workspace). This registry is the one list the popover draws from, so it cannot disagree with the
 * routes about where a section lives. `/library` itself has no overview: it redirects to Files.
 */
export type LibrarySectionKey =
  | 'files'
  | 'media'
  | 'templates'
  | 'knowledge'
  | 'collections'
  | 'sources'
  | 'trash';

export type LibrarySection = {
  key: LibrarySectionKey;
  label: string;
  /** Path segment under `library/`. */
  path: string;
};

export const LIBRARY_SECTIONS: readonly LibrarySection[] = [
  { key: 'files', label: 'Files', path: 'files' },
  { key: 'media', label: 'Media', path: 'media' },
  { key: 'templates', label: 'Templates', path: 'templates' },
  { key: 'knowledge', label: 'Knowledge', path: 'knowledge' },
  { key: 'collections', label: 'Collections', path: 'collections' },
  { key: 'sources', label: 'Sources', path: 'sources' },
  { key: 'trash', label: 'Trash', path: 'trash' },
] as const;

/** The section tab strip on each Library page: every destination, in registry order. */
export const LIBRARY_TABS: readonly LibrarySection[] = LIBRARY_SECTIONS;

/** The section that `/organizations/{id}/library` redirects to: the first destination. */
export const LIBRARY_DEFAULT_SECTION: LibrarySectionKey = 'files';

export function libraryHref(organizationId: string, key: LibrarySectionKey): string {
  const section = LIBRARY_SECTIONS.find((candidate) => candidate.key === key);
  if (!section) throw new Error(`No Library section has the key "${key}".`);
  return `/organizations/${organizationId}/library/${section.path}`;
}

export function librarySourceHref(organizationId: string, resourceId: string): string {
  return `${libraryHref(organizationId, 'sources')}/${resourceId}`;
}

// Imports are Sources' history: their pages live under the Sources area's own path, not a section of their own.
const importsBase = (organizationId: string) => `/organizations/${organizationId}/library/imports`;

export function libraryImportHref(organizationId: string, runId: string, search = ''): string {
  return `${importsBase(organizationId)}/${runId}${search}`;
}

export function libraryNewImportHref(organizationId: string, resourceId?: string): string {
  return `${importsBase(organizationId)}/new${resourceId ? `?resourceId=${resourceId}` : ''}`;
}

/** The Library section a pathname belongs to, Imports included (they are Sources' history). */
export function activeLibrarySection(organizationId: string, pathname: string): LibrarySectionKey | null {
  const path = pathname.replace(/\/$/, '');
  if (path === importsBase(organizationId) || path.startsWith(`${importsBase(organizationId)}/`)) return 'sources';
  const match = LIBRARY_SECTIONS.find((section) => {
    const href = libraryHref(organizationId, section.key);
    return path === href || path.startsWith(`${href}/`);
  });
  return match?.key ?? null;
}
