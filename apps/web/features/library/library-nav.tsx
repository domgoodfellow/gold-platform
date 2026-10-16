import { ViewNav } from '@/components/navigation/view-nav';
import { LIBRARY_SECTIONS, libraryHref, type LibrarySectionKey } from '@/lib/route/library';

export function LibraryNav({ organizationId, active }: { organizationId: string; active: LibrarySectionKey }) {
  return <ViewNav label="Library" current={active} className="mb-6" views={LIBRARY_SECTIONS.map(section => ({
    key: section.key, label: section.label, href: libraryHref(organizationId, section.key),
  }))} />;
}
