import { redirect } from 'next/navigation';

export default async function AccessRootPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/access'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/access/members`);
}
