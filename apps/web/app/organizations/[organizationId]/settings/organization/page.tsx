import { redirect } from 'next/navigation';

/** The retired Organization directory. Its address stays valid and lands on the business profile. */
export default async function OrganizationSettingsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/settings/organization'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/general`);
}
