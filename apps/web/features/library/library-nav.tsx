import { ViewNav } from '@/components/navigation/view-nav';
import { LIBRARY_TABS, libraryHref, type LibrarySectionKey } from '@/lib/route/library';

export function LibraryNav({ organizationId, active }: { organizationId: string; active: LibrarySectionKey }) {
  return <ViewNav label="Library" current={active} className="mb-6" views={LIBRARY_TABS.map(section => ({
    key: section.key, label: section.label, href: libraryHref(organizationId, section.key),
  }))} />;
}
