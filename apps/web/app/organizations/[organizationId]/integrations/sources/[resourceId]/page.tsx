import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacySourcePage({ params, searchParams }: { params: Promise<{ organizationId: string; resourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, resourceId } = await params;
  redirect(configurationRedirectHref(organizationId, `library/sources/${resourceId}`, await searchParams));
}
