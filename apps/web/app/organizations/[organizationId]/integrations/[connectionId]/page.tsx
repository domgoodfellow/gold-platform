import { redirect } from 'next/navigation';

export default async function LegacyConnectionPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations/[connectionId]'>) {
  const { organizationId, connectionId } = await params;
  const query = await searchParams;
  const target = new URL(`/organizations/${organizationId}/settings/connections/${connectionId}`, 'http://local');
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(key, item);
  }
  redirect(`${target.pathname}${target.search}`);
}
