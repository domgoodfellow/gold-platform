import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibrarySourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/sources'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      active="sources"
      label="Sources"
      description="Where Library content originates."
      empty="No connected sources yet."
    />
  );
}
