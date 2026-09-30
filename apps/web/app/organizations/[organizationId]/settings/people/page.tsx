import { redirect } from 'next/navigation';

/** Moved back to `/roles`, its canonical workspace — Settings is one organization Area, not a second application shell (`CLAUDE.md`). */
export default async function PeopleSettingsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/settings/people'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/access`);
}
