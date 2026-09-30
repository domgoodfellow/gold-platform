import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** See `../page.tsx`: Plans & Add-ons moved to Finance. Kept only so a bookmark still resolves. */
export default async function LegacyPlatformPlanDetailRoute({ params }: PageProps<'/organizations/[organizationId]/platform/catalog/plans/[planKey]'>) {
  const { organizationId, planKey } = await params;
  redirect(`/organizations/${organizationId}/finance/plans/${planKey}`);
}
