import { redirect } from 'next/navigation';
import { withQuery } from '@/lib/route/query';

/** Retired address of Workflows; kept so saved links and history land on the same collection. */
export default async function RetiredRulesPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/rules'>) {
  const { organizationId } = await params;
  redirect(withQuery(`/organizations/${organizationId}/automations/workflows`, await searchParams));
}
