/**
 * Library is one destination with several internal sections — Files, Media, Templates, Knowledge,
 * Collections, Sources, Imports and Trash — reached from Library's own navigation rather than a second
 * permanent sidebar (docs/ui-spec.md: Library is shared organization infrastructure, never a
 * workspace). This registry exists so the one tab bar every section renders (`LibraryNav`) cannot
 * disagree with itself about where a section lives.
 */
export type LibrarySectionKey =
  | 'home'
  | 'files'
  | 'media'
  | 'templates'
  | 'knowledge'
  | 'collections'
  | 'sources'
  | 'imports'
  | 'trash';

export type LibrarySection = {
  key: LibrarySectionKey;
  label: string;
  /** Path segment under `library/`, or empty for Library's own root. */
  path: string;
};

export const LIBRARY_SECTIONS: readonly LibrarySection[] = [
  { key: 'home', label: 'Home', path: '' },
  { key: 'files', label: 'Files', path: 'files' },
  { key: 'media', label: 'Media', path: 'media' },
  { key: 'templates', label: 'Templates', path: 'templates' },
  { key: 'knowledge', label: 'Knowledge', path: 'knowledge' },
  { key: 'collections', label: 'Collections', path: 'collections' },
  { key: 'sources', label: 'Sources', path: 'sources' },
  { key: 'imports', label: 'Imports', path: 'imports' },
  { key: 'trash', label: 'Trash', path: 'trash' },
] as const;

export function libraryHref(organizationId: string, key: LibrarySectionKey): string {
  const section = LIBRARY_SECTIONS.find((candidate) => candidate.key === key);
  if (!section) throw new Error(`No Library section has the key "${key}".`);
  return `/organizations/${organizationId}/library${section.path ? `/${section.path}` : ''}`;
}

export function librarySourceHref(organizationId: string, resourceId: string): string {
  return `${libraryHref(organizationId, 'sources')}/${resourceId}`;
}

export function libraryImportHref(organizationId: string, runId: string, search = ''): string {
  return `${libraryHref(organizationId, 'imports')}/${runId}${search}`;
}

export function libraryNewImportHref(organizationId: string, resourceId?: string): string {
  return `${libraryHref(organizationId, 'imports')}/new${resourceId ? `?resourceId=${resourceId}` : ''}`;
}
