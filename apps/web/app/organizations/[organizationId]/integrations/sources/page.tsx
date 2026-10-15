import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacySourcesPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await params;
  redirect(configurationRedirectHref(organizationId, 'library/sources', await searchParams));
}
