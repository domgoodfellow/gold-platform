import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryFilesPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/files'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      active="files"
      label="Files"
      description="Files shared across this business's workspaces, rather than attached to one record."
      empty="No files in Library yet."
    />
  );
}
