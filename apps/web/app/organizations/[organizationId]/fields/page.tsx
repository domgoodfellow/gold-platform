import { redirect } from 'next/navigation';

/**
 * Moved to Settings → Data & automation, the "Custom fields" tab. Kept as a redirect — this
 * segment stays in `navigation.ts`'s `AREAS` (`sidebar: false`, unchanged) so a bookmark still
 * lands somewhere real.
 */
export default async function FieldsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/fields'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/data-automation`);
}
