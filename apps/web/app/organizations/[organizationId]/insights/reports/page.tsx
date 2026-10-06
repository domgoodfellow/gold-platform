import { redirect } from 'next/navigation';
import { areaHref } from '@/lib/navigation';

export default async function InsightsReportsPage({
  params,
}: PageProps<'/organizations/[organizationId]/insights/reports'>) {
  const { organizationId } = await params;
  redirect(areaHref(organizationId, 'home'));
}
