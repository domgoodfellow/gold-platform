import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** See `../page.tsx`. Bookmark redirect only. */
export default async function LegacyFinanceEconomicsDetailRoute({ params }: PageProps<'/organizations/[organizationId]/finance/economics/[targetOrganizationId]'>) {
  const { organizationId, targetOrganizationId } = await params;
  redirect(`/organizations/${organizationId}/platform/economics/${targetOrganizationId}`);
}
