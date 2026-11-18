import { redirect } from 'next/navigation';
import { withQuery } from '@/lib/route/query';

/** Retired address of a workflow; kept so saved links and history open the same rule. */
export default async function RetiredRulePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/[ruleId]'>) {
  const { organizationId, ruleId } = await params;
  redirect(withQuery(`/organizations/${organizationId}/automations/workflows/${encodeURIComponent(ruleId)}`, await searchParams));
}
