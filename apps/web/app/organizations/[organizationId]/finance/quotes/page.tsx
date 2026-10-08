import { FinanceCollection } from '@/features/finance/collections/finance-collection';

export const dynamic = 'force-dynamic';
export default async function CollectionPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/quotes'>) {
  const { organizationId } = await params;
  return <FinanceCollection organizationId={organizationId} kind="quotes" query={await searchParams} />;
}
