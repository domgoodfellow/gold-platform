import { redirect } from 'next/navigation';

export default async function LegacyIntegrationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const target = new URL(
    `/organizations/${organizationId}/settings/connections${view === 'browse' ? '/apps' : ''}`,
    'http://local',
  );
  for (const [key, value] of Object.entries(query)) {
    if (key === 'view' || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(key, item);
  }
  redirect(`${target.pathname}${target.search}`);
}
