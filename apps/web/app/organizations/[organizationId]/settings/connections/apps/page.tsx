import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function BrowseAppsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/connections/apps'>) {
  const { organizationId } = await params;
  redirect(configurationRedirectHref(organizationId, 'settings/connections', { ...(await searchParams), catalog: 'open' }));
}
