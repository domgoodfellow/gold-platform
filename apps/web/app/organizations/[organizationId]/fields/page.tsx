import { redirect } from 'next/navigation';

export default async function LegacyFieldsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/fields'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const entity = Array.isArray(query.entity) ? query.entity[0] : query.entity;
  const target = new URL(`/organizations/${organizationId}/settings/custom-fields`, 'http://local');
  if (entity) target.searchParams.set('entity', entity);
  redirect(`${target.pathname}${target.search}`);
}
