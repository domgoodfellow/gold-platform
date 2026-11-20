import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Plans and add-ons are recurring items in Catalog & Pricing (ADR-057). Kept so a bookmark still lands; the catalog guards itself. */
export default async function LegacyFinancePlansRoute({ params }: PageProps<'/organizations/[organizationId]/finance/plans'>): Promise<never> {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/finance/catalog`);
}
