import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryMediaPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/media'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      label="Media"
      description="Images, video and audio reusable across this business's workspaces."
      empty="No media in Library yet."
    />
  );
}
