import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Website earned its own operating page — the Studio workbench. This address is kept only
 * so an existing link or bookmark still lands somewhere real, never a dead end.
 */
export default async function WebsiteSettingsRedirect({ params }: PageProps<'/organizations/[organizationId]/settings/website'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/studio/website`);
}
