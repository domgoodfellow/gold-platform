import { redirect } from 'next/navigation';
import { libraryHref } from '@/lib/route/library';

// Imports are Sources' history. The old list address stays so bookmarks keep working.
export default async function ImportRunsPage({
  params,
}: PageProps<'/organizations/[organizationId]/library/imports'>) {
  const { organizationId } = await params;
  redirect(libraryHref(organizationId, 'sources'));
}
