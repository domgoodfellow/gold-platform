import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryTrashPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/trash'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      active="trash"
      label="Trash"
      description="Archived Library content."
      empty="Nothing archived."
    />
  );
}
