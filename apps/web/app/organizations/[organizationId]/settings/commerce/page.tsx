import { redirect } from 'next/navigation';

/** Moved back to `/pricing`, its canonical workspace — Settings is one organization Area, not a second application shell (`CLAUDE.md`). Card payments' "Getting paid" section moved with it, at `#getting-paid`. */
export default async function CommerceSettingsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/settings/commerce'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/pricing`);
}
