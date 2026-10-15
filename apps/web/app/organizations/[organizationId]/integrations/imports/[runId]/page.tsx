import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacyImportRunPage({ params, searchParams }: { params: Promise<{ organizationId: string; runId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, runId } = await params;
  redirect(configurationRedirectHref(organizationId, `library/imports/${runId}`, await searchParams));
}
