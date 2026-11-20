import { redirect } from 'next/navigation';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * See `../page.tsx`. A plan key resolves to the recurring item that sells it; the item's page
 * guards itself, so this reveals only what the public plan list already does.
 */
export default async function LegacyFinancePlanRoute({ params }: PageProps<'/organizations/[organizationId]/finance/plans/[planKey]'>): Promise<never> {
  const { organizationId, planKey } = await params;
  const { db } = await requireOrganization(organizationId);
  const plan = await getPlan(db, planKey);
  redirect(`/organizations/${organizationId}/finance/catalog${plan?.priceBookItemId ? `/${plan.priceBookItemId}` : ''}`);
}
