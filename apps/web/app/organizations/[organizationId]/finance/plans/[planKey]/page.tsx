import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** See `../page.tsx`: Plans & Add-ons belongs to Platform. Kept only so a bookmark still resolves. */
export default async function LegacyFinancePlanDetailRoute({ params }: PageProps<'/organizations/[organizationId]/finance/plans/[planKey]'>) {
  const { organizationId, planKey } = await params;
  redirect(`/organizations/${organizationId}/platform/plans/${planKey}`);
}
