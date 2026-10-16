'use client';

import Link from 'next/link';
import { tabsListClassName, tabsTriggerClassName } from '@gold/ui/components/tab-styles';
import { cx } from '@/components/class-names';
import { LIBRARY_SECTIONS, libraryHref, type LibrarySectionKey } from '@/lib/route/library';

/**
 * The one tab bar every Library section renders — Files, Media, Templates, Knowledge,
 * Collections, Sources and Trash are sections of one destination, not seven pages that happen to
 * share a URL prefix. `active` is never inferred from the pathname: a section's own page always
 * knows which one it is.
 */
export function LibraryNav({ organizationId, active }: { organizationId: string; active: LibrarySectionKey }) {
  return (
    <nav aria-label="Library" data-slot="tabs-list" className={cx(tabsListClassName, 'mb-6 sm:w-full')}>
      {LIBRARY_SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={libraryHref(organizationId, section.key)}
          aria-current={section.key === active ? 'page' : undefined}
          data-slot="tabs-trigger"
          className={tabsTriggerClassName}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
