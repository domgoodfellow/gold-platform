import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { NavigationList } from '@/components/navigation/navigation-list';
import { LibraryNav } from '@/features/library/library-nav';
import { LIBRARY_SECTIONS, libraryHref } from '@/lib/route/library';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryPage({ params }: PageProps<'/organizations/[organizationId]/library'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  return <WorkspaceHome title={areaLabel('library')}>
    <LibraryNav organizationId={organizationId} active="home" />
    <NavigationList label="Library destinations" density="compact" className="sm:grid-cols-2" items={LIBRARY_SECTIONS.filter(section => section.key !== 'home').map(section => ({
      key: section.key, title: section.label, href: libraryHref(organizationId, section.key), chevron: true,
    }))} />
  </WorkspaceHome>;
}
