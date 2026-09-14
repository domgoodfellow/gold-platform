import { redirect } from 'next/navigation';

/**
 * Moved to Settings → Data & automation, the "Automation rules" tab. Kept as a redirect — this
 * segment stays in `navigation.ts`'s `AREAS` (`sidebar: false`, unchanged), and `MODULES`'s
 * `automations`/`weather`/`maintenance` entries still resolve `configuredAt` here by design:
 * the link lands on this redirect and forwards immediately, so D31's "a switch leads to its
 * inputs" contract holds without any change to `navigation.ts` or its tests.
 */
export default async function AutomationsRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/data-automation`);
}
