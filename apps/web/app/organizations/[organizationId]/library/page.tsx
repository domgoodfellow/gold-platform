import { redirect } from 'next/navigation';
import { LIBRARY_DEFAULT_SECTION, libraryHref } from '@/lib/route/library';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Library has no overview: its destinations live in the sidebar's Library popover, so the root opens the first one. */
export default async function LibraryPage({ params }: PageProps<'/organizations/[organizationId]/library'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  redirect(libraryHref(organizationId, LIBRARY_DEFAULT_SECTION));
}
