import { redirect } from 'next/navigation';
import { configurationRedirectHref } from '@/lib/route/configuration-redirect';

export default async function LegacyConfiguration({ params, searchParams }: PageProps<'/organizations/[organizationId]/settings/calls'>) {
  const { organizationId } = await params;
  redirect(configurationRedirectHref(organizationId, 'comms/configuration/calling', await searchParams));
}
