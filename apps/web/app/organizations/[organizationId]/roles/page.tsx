import { redirect } from 'next/navigation';

export default async function LegacyRolesPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/roles'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = rawView === 'invitations' || rawView === 'roles' ? rawView : 'members';
  redirect(`/organizations/${organizationId}/settings/access/${view}`);
}
