import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** See `../page.tsx`. */
export default async function RetiredPlatformPlanRoute({ params }: PageProps<'/platform/plans/[planKey]'>): Promise<never> {
  const { planKey } = await params;
  redirect(`/platform/catalog/plans/${encodeURIComponent(planKey)}`);
}
