import { redirect } from 'next/navigation';

/**
 * Moved to Settings → Business commerce, the "Services & pricing" section. Kept as a redirect —
 * `MODULES`'s `billing.configuredAt` still resolves this segment (`navigation.ts`'s `AREAS`
 * entry for `pricing` is unchanged), so the link lands here and forwards immediately.
 */
export default async function PricingRedirect({
  params,
}: PageProps<'/organizations/[organizationId]/pricing'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/settings/commerce`);
}
