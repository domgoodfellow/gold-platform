import { redirect } from 'next/navigation';
import { withQuery } from '@/lib/route/query';

/** Retired address of Runs; kept so saved links and history land on the same records. */
export default async function RetiredActivityPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/activity'>) {
  const { organizationId } = await params;
  redirect(withQuery(`/organizations/${organizationId}/automations/runs`, await searchParams));
}
