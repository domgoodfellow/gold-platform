'use client';

import Link from 'next/link';
import { cx, FOCUS_RING } from '@/components/class-names';
import { LIBRARY_SECTIONS, libraryHref, type LibrarySectionKey } from '@/lib/route/library';

/**
 * The one tab bar every Library section renders — Files, Media, Templates, Knowledge,
 * Collections, Sources and Trash are sections of one destination, not seven pages that happen to
 * share a URL prefix. `active` is never inferred from the pathname: a section's own page always
 * knows which one it is.
 */
export function LibraryNav({ organizationId, active }: { organizationId: string; active: LibrarySectionKey }) {
  return (
    <nav aria-label="Library" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {LIBRARY_SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={libraryHref(organizationId, section.key)}
          aria-current={section.key === active ? 'page' : undefined}
          className={cx(
            FOCUS_RING,
            '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm',
            section.key === active
              ? 'border-foreground font-medium'
              : 'border-transparent text-muted hover:text-foreground',
          )}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
