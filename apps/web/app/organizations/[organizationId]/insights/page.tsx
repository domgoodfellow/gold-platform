import { redirect } from 'next/navigation';
import { areaHref } from '@/lib/navigation';

export default async function InsightsPage({
  params,
}: PageProps<'/organizations/[organizationId]/insights'>) {
  const { organizationId } = await params;
  redirect(areaHref(organizationId, 'home'));
}
