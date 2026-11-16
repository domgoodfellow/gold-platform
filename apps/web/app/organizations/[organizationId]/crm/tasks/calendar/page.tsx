import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { legacyCalendarHref } from '@/lib/application/calendar/navigation';

export default async function LegacyCalendarPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  return redirect(legacyCalendarHref(organizationId, 'crm', await searchParams));
}
