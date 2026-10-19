import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryCollectionsPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/collections'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      label="Collections"
      description="Groups of Library content, for organizing files, media, templates and knowledge together."
      empty="No collections yet."
    />
  );
}
