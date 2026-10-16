import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';

export default async function LegacyCalendarPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const suffix = query.toString();
  redirect(`/organizations/${organizationId}/calendar${suffix ? `?${suffix}` : ''}`);
}
