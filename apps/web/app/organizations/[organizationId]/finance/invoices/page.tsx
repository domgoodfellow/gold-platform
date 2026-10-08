import { FinanceCollection } from '@/features/finance/collections/finance-collection';

export const dynamic = 'force-dynamic';
export default async function CollectionPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/invoices'>) {
  const { organizationId } = await params;
  return <FinanceCollection organizationId={organizationId} kind="invoices" query={await searchParams} />;
}
