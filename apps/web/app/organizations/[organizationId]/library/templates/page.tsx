import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryTemplatesPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/templates'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      label="Templates"
      description="Reusable templates shared across this business's workspaces."
      empty="No shared templates yet."
    />
  );
}
