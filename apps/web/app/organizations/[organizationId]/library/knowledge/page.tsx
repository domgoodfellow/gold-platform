import { LibrarySectionPage } from '@/features/library/library-section-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LibraryKnowledgePage({
  params,
}: PageProps<'/organizations/[organizationId]/library/knowledge'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <LibrarySectionPage
      organizationId={organizationId}
      active="knowledge"
      label="Knowledge"
      description="Content made available to the Agent and other retrieval-aware surfaces."
      empty="No knowledge sources yet."
    />
  );
}
