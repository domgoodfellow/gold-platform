import { redirect } from 'next/navigation';

/**
 * Moved to Settings → People & access, one page with three tabs (Members, Invitations, Roles &
 * permissions) instead of three things stacked on this one. Kept as a redirect rather than
 * deleted outright — this segment stays in `navigation.ts`'s `AREAS` (`sidebar: false`, unchanged)
 * so a bookmark, an old link in an invitation email, or `moduleConfiguration`'s own href
 * resolution still lands somewhere real rather than a 404.
 */
export default async function RolesRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/people`);
}
