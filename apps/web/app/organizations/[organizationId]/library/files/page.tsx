import { uploadLibraryFileAction } from './actions';
import { LibraryFilesCollection } from '@/features/library/files/library-files';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryFilesPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/library/files'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  return (
    <LibraryFilesCollection
      db={db}
      organizationId={organizationId}
      timezone={organization.timezone}
      capabilities={organization.capabilities}
      query={query}
      upload={uploadLibraryFileAction}
    />
  );
}
