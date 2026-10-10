import { FinanceCollection } from '@/features/finance/collections/finance-collection';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';
export default async function CollectionPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/quotes'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  return <FinanceCollection organizationId={organizationId} kind="quotes" query={await searchParams} />;
}
